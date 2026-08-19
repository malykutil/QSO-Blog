import hashlib
import html
import logging
import re
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from time import struct_time
from typing import Protocol
from urllib.parse import quote_plus

import feedparser
import requests

from stock_assistant.config import Settings
from stock_assistant.db import Repository
from stock_assistant.models import NewsArticle
from stock_assistant.telegram import TelegramNotifier

logger = logging.getLogger(__name__)

NEWS_INITIALIZED_STATE = "news_monitor_initialized"
_SPACE_PATTERN = re.compile(r"\s+")

# Deterministic headline triage. It controls notifications only, never trades.
_NEGATIVE_TERMS: dict[str, int] = {
    "bankruptcy": 5,
    "accounting fraud": 5,
    "fraud investigation": 5,
    "data breach": 4,
    "ceo resign": 4,
    "guidance cut": 4,
    "cuts guidance": 4,
    "recall": 3,
    "downgrade": 2,
    "lawsuit": 2,
    "investigation": 2,
    "earnings miss": 3,
    "misses estimates": 3,
    "layoffs": 2,
    "share offering": 3,
    "market crash": 5,
    "market plunge": 4,
    "sell-off": 3,
    "circuit breaker": 5,
}
_POSITIVE_TERMS: dict[str, int] = {
    "earnings beat": 3,
    "beats estimates": 3,
    "raises guidance": 4,
    "guidance raised": 4,
    "fda approval": 4,
    "wins contract": 3,
    "share buyback": 3,
    "stock buyback": 3,
    "acquisition": 3,
    "to acquire": 3,
    "merger": 3,
    "record revenue": 3,
}
_MARKET_TERMS: dict[str, int] = {
    "federal reserve": 2,
    "fed rate": 3,
    "interest rate": 2,
    "inflation report": 2,
    "jobs report": 2,
    "tariff": 2,
    "recession": 3,
    "geopolitical": 2,
}


def score_headline(title: str) -> tuple[int, str]:
    """Return deterministic significance and sentiment from an untrusted headline."""
    normalized = _SPACE_PATTERN.sub(" ", html.unescape(title)).strip().casefold()
    negative = max(
        (score for term, score in _NEGATIVE_TERMS.items() if term in normalized),
        default=0,
    )
    positive = max(
        (score for term, score in _POSITIVE_TERMS.items() if term in normalized),
        default=0,
    )
    market = max((score for term, score in _MARKET_TERMS.items() if term in normalized), default=0)
    score = min(10, max(negative, positive, market))
    if negative >= positive and negative > 0:
        return score, "NEGATIVE"
    if positive > negative:
        return score, "POSITIVE"
    return score, "NEUTRAL"


class NewsProvider(Protocol):
    def search(
        self, query: str, *, ticker: str | None = None, limit: int = 10
    ) -> list[NewsArticle]: ...


class GoogleNewsRssProvider:
    """Small read-only client for public Google News RSS search results."""

    endpoint = "https://news.google.com/rss/search"

    def __init__(self, *, timeout: float = 15.0, session: requests.Session | None = None) -> None:
        self.timeout = timeout
        self.session = session or requests.Session()
        self.session.headers.update(
            {"User-Agent": "paper-stock-assistant/0.1 (read-only RSS monitor)"}
        )

    def search(
        self,
        query: str,
        *,
        ticker: str | None = None,
        limit: int = 10,
    ) -> list[NewsArticle]:
        url = (
            f"{self.endpoint}?q={quote_plus(query)}&hl=en-US&gl=US&ceid=US%3Aen"
        )
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        return self.parse(response.content, query=query, ticker=ticker, limit=limit)

    @staticmethod
    def parse(
        content: bytes,
        *,
        query: str,
        ticker: str | None = None,
        limit: int = 10,
    ) -> list[NewsArticle]:
        feed = feedparser.parse(content)
        articles: list[NewsArticle] = []
        for entry in feed.entries:
            title = _SPACE_PATTERN.sub(
                " ", html.unescape(str(entry.get("title", "")))
            ).strip()
            url = str(entry.get("link", "")).strip()
            published_struct: struct_time | None = entry.get("published_parsed") or entry.get(
                "updated_parsed"
            )
            if not title or not url or published_struct is None:
                continue
            published_at = datetime(*published_struct[:6], tzinfo=UTC)
            source_value = entry.get("source") or {}
            source = (
                str(source_value.get("title", "")).strip()
                if hasattr(source_value, "get")
                else str(source_value).strip()
            ) or "Unknown source"
            normalized_key = f"{title.casefold()}|{source.casefold()}"
            fingerprint = hashlib.sha256(normalized_key.encode("utf-8")).hexdigest()
            significance_score, sentiment = score_headline(title)
            articles.append(
                NewsArticle(
                    fingerprint=fingerprint,
                    title=title,
                    url=url,
                    source=source,
                    published_at=published_at,
                    ticker=ticker.upper() if ticker else None,
                    query=query,
                    significance_score=significance_score,
                    sentiment=sentiment,
                )
            )
            if len(articles) >= limit:
                break
        return articles


class NewsMonitor:
    """Collect, deduplicate and selectively notify without affecting execution logic."""

    def __init__(
        self,
        *,
        settings: Settings,
        repository: Repository,
        provider: NewsProvider,
        notifier: TelegramNotifier,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.settings = settings
        self.repository = repository
        self.provider = provider
        self.notifier = notifier
        self.clock = clock or (lambda: datetime.now(UTC))

    def run(self) -> None:
        if not self.settings.news_enabled:
            return
        first_run = self.repository.get_state(NEWS_INITIALIZED_STATE) is None
        queries = [(None, self.settings.news_global_query)]
        queries.extend(
            (ticker, f'"{ticker}" stock when:1d')
            for ticker in self.repository.get_positions()
        )
        fetched_any = False
        collected: dict[str, NewsArticle] = {}
        for ticker, query in queries:
            try:
                articles = self.provider.search(
                    query,
                    ticker=ticker,
                    limit=self.settings.news_max_per_query,
                )
                fetched_any = True
                for article in articles:
                    current = collected.get(article.fingerprint)
                    if current is None or (current.ticker is None and article.ticker is not None):
                        collected[article.fingerprint] = article
            except Exception as exc:
                logger.error(
                    "News query failed safely scope=%s error_type=%s",
                    ticker or "GLOBAL",
                    type(exc).__name__,
                )

        cutoff = self.clock().astimezone(UTC) - timedelta(hours=self.settings.news_max_age_hours)
        new_count = 0
        for article in collected.values():
            if article.published_at < cutoff:
                continue
            new_count += int(self.repository.save_news_article(article))

        if not fetched_any:
            logger.warning("News monitor completed without a successful feed")
            return

        pending = self.repository.pending_news(
            minimum_score=self.settings.news_alert_score_threshold,
            since=cutoff,
            limit=100,
        )
        pending.sort(
            key=lambda article: (
                article.ticker is not None,
                article.significance_score,
                article.published_at,
            ),
            reverse=True,
        )
        if first_run:
            to_send = pending[: self.settings.news_bootstrap_alerts]
            suppressed = pending[self.settings.news_bootstrap_alerts :]
            for article in suppressed:
                self.repository.mark_news_alerted(article.fingerprint)
        else:
            to_send = pending[: self.settings.news_max_alerts_per_cycle]

        sent_count = 0
        for article in to_send:
            try:
                if self.notifier.send_news(article):
                    self.repository.mark_news_alerted(article.fingerprint)
                    sent_count += 1
            except Exception as exc:
                logger.error(
                    "News Telegram delivery failed fingerprint=%s error_type=%s",
                    article.fingerprint[:12],
                    type(exc).__name__,
                )
        self.repository.set_state(NEWS_INITIALIZED_STATE, self.clock().isoformat())
        logger.info(
            "News monitor complete fetched=%d new=%d significant_pending=%d sent=%d",
            len(collected),
            new_count,
            len(pending),
            sent_count,
        )
