import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pandas_market_calendars as mcal

from stock_assistant.agent_league import AgentLeague
from stock_assistant.config import Settings
from stock_assistant.db import Repository
from stock_assistant.indicators import InvalidMarketData, build_snapshot
from stock_assistant.llm import Analyzer
from stock_assistant.market_data import YahooMarketDataProvider
from stock_assistant.models import NewsArticle, ScreeningCandidate
from stock_assistant.news import NewsProvider
from stock_assistant.paper import PaperBroker
from stock_assistant.screening import DeterministicScreener, data_is_valid
from stock_assistant.telegram import TelegramNotifier
from stock_assistant.universe import UniverseProvider

logger = logging.getLogger(__name__)


def nyse_is_open(now: datetime | None = None) -> bool:
    now = (now or datetime.now(UTC)).astimezone(UTC)
    calendar = mcal.get_calendar("NYSE")
    schedule = calendar.schedule(start_date=now.date(), end_date=now.date())
    if schedule.empty:
        return False
    market_open = schedule.iloc[0]["market_open"].to_pydatetime()
    market_close = schedule.iloc[0]["market_close"].to_pydatetime()
    return market_open <= now <= market_close


class TradingCycle:
    def __init__(
        self,
        *,
        settings: Settings,
        repository: Repository,
        universe: UniverseProvider,
        market_data: YahooMarketDataProvider,
        screener: DeterministicScreener,
        analyzer: Analyzer,
        broker: PaperBroker,
        notifier: TelegramNotifier,
        agent_league: AgentLeague | None = None,
        news_provider: NewsProvider | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.settings = settings
        self.repository = repository
        self.universe = universe
        self.market_data = market_data
        self.screener = screener
        self.analyzer = analyzer
        self.broker = broker
        self.notifier = notifier
        self.agent_league = agent_league
        self.news_provider = news_provider
        self.clock = clock or (lambda: datetime.now(UTC))

    def run(self) -> None:
        cycle_id = self.repository.start_cycle()
        universe_count = valid_count = screened_count = llm_count = 0
        try:
            cycle_now = self.clock()
            if not self.settings.run_outside_market_hours and not nyse_is_open(cycle_now):
                logger.info("US equity market is closed; cycle skipped")
                self.repository.finish_cycle(cycle_id, status="SKIPPED_MARKET_CLOSED")
                return

            symbols = self.universe.get_symbols(self.settings.override_symbols)
            positions = self.repository.get_positions()
            symbols = sorted(set(symbols) | set(positions))
            universe_count = len(symbols)
            logger.info("Cycle %d downloading %d symbols", cycle_id, universe_count)
            frames = self.market_data.fetch(symbols)

            snapshots = {}
            validation_now = self.clock()
            for ticker, frame in frames.items():
                try:
                    snapshot = build_snapshot(ticker, frame)
                    valid, reason = data_is_valid(
                        snapshot,
                        now=validation_now,
                        max_age_minutes=self.settings.max_quote_age_minutes,
                    )
                    if not valid:
                        logger.debug("Rejected %s data: %s", ticker, reason)
                        continue
                    snapshots[ticker] = snapshot
                except (InvalidMarketData, ValueError) as exc:
                    logger.debug("Rejected %s data: %s", ticker, exc)
            valid_count = len(snapshots)
            prices = {ticker: snapshot.current_price for ticker, snapshot in snapshots.items()}
            if self.agent_league is not None:
                self.agent_league.process(snapshots)

            # Hard exits run before the LLM, using only validated authoritative prices.
            exited_tickers: set[str] = set()
            for ticker in list(positions):
                snapshot = snapshots.get(ticker)
                if snapshot is None:
                    logger.warning("No valid data for open position %s; no exit fabricated", ticker)
                    continue
                execution = self.broker.protective_exit(ticker, snapshot.current_price)
                if execution:
                    exited_tickers.add(ticker)
                    self._notify_safely(execution)

            positions = self.repository.get_positions()
            for ticker, position in positions.items():
                snapshot = snapshots.get(ticker)
                if snapshot is None:
                    continue
                try:
                    self.notifier.send_position_update(
                        position, snapshot.current_price, snapshot.timestamp
                    )
                except Exception as exc:
                    logger.error(
                        "Telegram position update failed for %s error_type=%s",
                        ticker,
                        type(exc).__name__,
                    )

            candidates: list[ScreeningCandidate] = []
            for ticker, snapshot in snapshots.items():
                if ticker in exited_tickers:
                    # Never churn back into a symbol in the same bar as a protective exit.
                    continue
                candidate = self.screener.screen(
                    snapshot,
                    positions.get(ticker),
                    now=validation_now,
                    max_age_minutes=self.settings.max_quote_age_minutes,
                )
                if candidate:
                    candidates.append(candidate)
            candidates.sort(key=lambda item: item.score, reverse=True)
            candidates = candidates[: self.settings.max_llm_candidates]
            screened_count = len(candidates)
            logger.info(
                "Cycle %d: %d valid snapshots, %d sent to structured analysis",
                cycle_id,
                valid_count,
                screened_count,
            )

            for candidate in candidates:
                ticker = candidate.snapshot.ticker
                position = self.repository.get_positions().get(ticker)
                try:
                    news = self._load_candidate_news(ticker)
                    analysis = self.analyzer.analyze(candidate, position, news)
                    llm_count += 1
                    execution, reason = self.broker.process(analysis, candidate.snapshot, prices)
                    self.repository.save_signal(
                        analysis,
                        candidate.snapshot.current_price,
                        executed=execution is not None,
                        rejection_reason=(
                            None
                            if execution or "requires no paper execution" in reason
                            else reason
                        ),
                    )
                    if execution:
                        new_position = self.repository.get_positions().get(ticker)
                        self._notify_safely(execution, new_position)
                    else:
                        logger.info("%s %s: %s", ticker, analysis.action.value, reason)
                except Exception:
                    logger.exception("Candidate processing failed safely for %s", ticker)

            self.repository.finish_cycle(
                cycle_id,
                status="SUCCESS",
                universe_count=universe_count,
                valid_count=valid_count,
                screened_count=screened_count,
                llm_count=llm_count,
            )
        except Exception as exc:
            logger.exception("Trading cycle %d failed", cycle_id)
            self.repository.finish_cycle(
                cycle_id,
                status="FAILED",
                universe_count=universe_count,
                valid_count=valid_count,
                screened_count=screened_count,
                llm_count=llm_count,
                error=str(exc)[:1000],
            )

    def _load_candidate_news(self, ticker: str) -> list[NewsArticle]:
        cutoff = self.clock().astimezone(UTC) - timedelta(
            hours=self.settings.news_max_age_hours
        )
        if self.settings.news_enabled and self.news_provider is not None:
            try:
                articles = self.news_provider.search(
                    f'"{ticker}" company stock when:1d',
                    ticker=ticker,
                    limit=self.settings.news_max_per_query,
                )
                recent = [article for article in articles if article.published_at >= cutoff]
                for article in recent:
                    self.repository.save_news_article(article)
                return recent
            except Exception as exc:
                logger.error(
                    "Candidate news fetch failed safely ticker=%s error_type=%s",
                    ticker,
                    type(exc).__name__,
                )
        return self.repository.recent_news(
            ticker=ticker,
            limit=self.settings.news_max_per_query,
            since=cutoff,
        )

    def _notify_safely(self, execution, position=None) -> None:
        try:
            self.notifier.send_execution(execution, position)
        except Exception as exc:
            logger.error(
                "Telegram delivery failed after durable paper execution %s %s error_type=%s",
                execution.side,
                execution.ticker,
                type(exc).__name__,
            )
