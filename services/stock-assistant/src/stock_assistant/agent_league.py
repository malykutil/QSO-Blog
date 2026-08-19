import logging
import math

from stock_assistant.config import Settings
from stock_assistant.db import Repository
from stock_assistant.models import IndicatorSnapshot

logger = logging.getLogger(__name__)


def score_snapshot(snapshot: IndicatorSnapshot) -> float:
    """Deterministic 0-100 score shared by the isolated PAPER agents."""
    trend_checks = (
        snapshot.current_price > snapshot.ema20,
        snapshot.ema20 > snapshot.ema50,
        snapshot.ema50 > snapshot.ema200,
        snapshot.trend_strength > 0,
        -2 <= snapshot.distance_ema20 <= 8,
    )
    trend = sum(trend_checks) * 6
    momentum = 0
    momentum += 8 if snapshot.momentum_20 > 0 else 0
    momentum += 6 if snapshot.macd_histogram > 0 else 0
    momentum += 6 if 50 <= snapshot.rsi <= 72 else 0
    volume = min(snapshot.relative_volume / 1.5, 1.0) * 15
    structure = 0
    structure += 10 if snapshot.current_price >= snapshot.recent_high_20 else 0
    structure += 5 if snapshot.current_price >= snapshot.recent_low_20 * 1.03 else 0
    atr_percent = snapshot.atr / snapshot.current_price * 100
    volatility = 10 if 0.5 <= atr_percent <= 5 else 0
    quality = 5 if abs(snapshot.gap_percent) <= 3 else 0
    quality += 5 if snapshot.close >= snapshot.open else 0
    return min(100.0, trend + momentum + volume + structure + volatility + quality)


def strategy_accepts(strategy: str, snapshot: IndicatorSnapshot, score: float) -> bool:
    bullish_stack = (
        snapshot.current_price > snapshot.ema20 > snapshot.ema50 > snapshot.ema200
    )
    breakout = (
        snapshot.current_price >= snapshot.recent_high_20
        and snapshot.relative_volume >= 1.5
        and snapshot.macd_histogram > 0
    )
    momentum = (
        snapshot.momentum_20 >= 2
        and snapshot.relative_volume >= 1.3
        and 55 <= snapshot.rsi <= 75
        and snapshot.macd_histogram > 0
    )
    if strategy == "TREND":
        return bullish_stack and 50 <= snapshot.rsi <= 70 and snapshot.momentum_20 > 0
    if strategy == "BREAKOUT":
        return breakout
    if strategy == "MOMENTUM":
        return momentum
    if strategy == "HYBRID":
        return score >= 80 and bullish_stack and (breakout or momentum)
    return False


class AgentLeague:
    """Four isolated deterministic PAPER portfolios sharing validated read-only quotes."""

    def __init__(self, repository: Repository, settings: Settings) -> None:
        self.repository = repository
        self.settings = settings

    def process(self, snapshots: dict[str, IndicatorSnapshot]) -> None:
        if not snapshots:
            return
        self.repository.save_market_quotes(snapshots)
        for account in self.repository.get_agent_accounts():
            if not account["enabled"]:
                continue
            agent_id = int(account["id"])
            try:
                self._process_agent(agent_id, str(account["strategy"]), snapshots)
                self.repository.record_agent_equity(agent_id)
            except Exception as exc:
                logger.error(
                    "Agent league cycle failed safely agent=%s error_type=%s",
                    account["slug"],
                    type(exc).__name__,
                )

    def _process_agent(
        self,
        agent_id: int,
        strategy: str,
        snapshots: dict[str, IndicatorSnapshot],
    ) -> None:
        state = self.repository.agent_runtime_state(agent_id)
        for position in list(state["positions"]):
            ticker = str(position["ticker"])
            snapshot = snapshots.get(ticker)
            if snapshot is None:
                continue
            if snapshot.current_price <= float(position["stop_loss"]):
                self.repository.agent_close_position(
                    agent_id=agent_id,
                    ticker=ticker,
                    price=snapshot.current_price,
                    reason="Dosažen ochranný stop-loss.",
                )
            elif snapshot.current_price >= float(position["target_2"]):
                self.repository.agent_close_position(
                    agent_id=agent_id,
                    ticker=ticker,
                    price=snapshot.current_price,
                    reason="Dosažen druhý cenový cíl.",
                )

        state = self.repository.agent_runtime_state(agent_id)
        positions = {str(position["ticker"]) for position in state["positions"]}
        if len(positions) >= self.settings.agent_max_positions:
            return

        ranked = sorted(
            (
                (score_snapshot(snapshot), snapshot)
                for snapshot in snapshots.values()
                if snapshot.ticker not in positions
            ),
            key=lambda item: item[0],
            reverse=True,
        )
        for score, snapshot in ranked:
            if score < self.settings.agent_min_score:
                break
            if not strategy_accepts(strategy, snapshot, score):
                continue
            if self._try_open(agent_id, strategy, snapshot, score):
                break  # At most one new position per agent and cycle.

    def _try_open(
        self,
        agent_id: int,
        strategy: str,
        snapshot: IndicatorSnapshot,
        score: float,
    ) -> bool:
        state = self.repository.agent_runtime_state(agent_id)
        equity = float(state["equity"])
        cash = float(state["cash"])
        entry = snapshot.current_price
        stop = entry - 1.5 * snapshot.atr
        if not (math.isfinite(stop) and 0 < stop < entry):
            return False
        risk_per_share = entry - stop
        remaining_portfolio_risk = max(
            equity * self.settings.agent_max_portfolio_risk - float(state["portfolio_risk"]),
            0,
        )
        risk_budget = min(
            equity * self.settings.agent_risk_per_trade,
            remaining_portfolio_risk,
        )
        exposure_budget = equity * self.settings.agent_max_symbol_exposure
        quantity = min(
            math.floor(risk_budget / risk_per_share),
            math.floor(exposure_budget / entry),
            math.floor(cash / entry),
        )
        if quantity < 1:
            return False
        target_1 = entry + self.settings.min_risk_reward * risk_per_share
        target_2 = entry + 4 * risk_per_share
        self.repository.agent_open_position(
            agent_id=agent_id,
            ticker=snapshot.ticker,
            quantity=quantity,
            price=entry,
            stop_loss=stop,
            target_1=target_1,
            target_2=target_2,
            scanner_score=score,
            reason=f"Strategie {strategy}: deterministické skóre {score:.1f}/100.",
        )
        logger.info(
            "Agent PAPER BUY agent_id=%d strategy=%s ticker=%s score=%.1f quantity=%d",
            agent_id,
            strategy,
            snapshot.ticker,
            score,
            quantity,
        )
        return True
