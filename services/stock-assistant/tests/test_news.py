import hashlib
from datetime import UTC, datetime

from stock_assistant.config import Settings
from stock_assistant.db import Repository
from stock_assistant.models import NewsArticle
from stock_assistant.news import GoogleNewsRssProvider, NewsMonitor, score_headline


def make_article(title: str, published_at: datetime, *, ticker: str | None = None) -> NewsArticle:
    return NewsArticle(
        fingerprint=hashlib.sha256(title.encode()).hexdigest(),
        title=title,
        url=f"https://example.com/{hashlib.md5(title.encode()).hexdigest()}",
        source="Example Wire",
        published_at=published_at,
        ticker=ticker,
        query=f"{ticker or 'market'} stock",
        significance_score=score_headline(title)[0],
        sentiment=score_headline(title)[1],
    )


def test_headline_scoring_is_deterministic():
    assert score_headline("Acme raises guidance after earnings")[0] == 4
    assert score_headline("Acme files for bankruptcy") == (5, "NEGATIVE")
    assert score_headline("Acme names a new product color") == (0, "NEUTRAL")


def test_google_rss_parser_requires_real_timestamp():
    xml = b"""<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel>
      <item><title>Acme raises guidance - Example Wire</title>
        <link>https://example.com/valid</link>
        <pubDate>Wed, 19 Aug 2026 12:00:00 GMT</pubDate>
        <source url="https://example.com">Example Wire</source></item>
      <item><title>Missing timestamp</title><link>https://example.com/invalid</link></item>
    </channel></rss>"""
    articles = GoogleNewsRssProvider.parse(xml, query="ACME stock", ticker="ACME")
    assert len(articles) == 1
    assert articles[0].ticker == "ACME"
    assert articles[0].published_at == datetime(2026, 8, 19, 12, 0, tzinfo=UTC)
    assert articles[0].source == "Example Wire"


def test_repository_deduplicates_news(tmp_path):
    repository = Repository(tmp_path / "paper.db", 100_000)
    repository.initialize()
    article = make_article("Acme raises guidance", datetime.now(UTC), ticker="ACME")
    assert repository.save_news_article(article)
    assert not repository.save_news_article(article)
    assert repository.recent_news(ticker="ACME") == [article]


class FakeProvider:
    def __init__(self, articles):
        self.articles = articles

    def search(self, query, *, ticker=None, limit=10):
        return [article for article in self.articles if article.ticker == ticker][:limit]


class RecordingNotifier:
    def __init__(self):
        self.sent = []

    def send_news(self, article):
        self.sent.append(article)
        return True


def test_news_monitor_bootstraps_without_flood_then_sends_only_new(tmp_path):
    now = datetime(2026, 8, 19, 15, 0, tzinfo=UTC)
    settings = Settings(
        database_path=tmp_path / "paper.db",
        universe_cache_path=tmp_path / "universe.json",
        news_bootstrap_alerts=1,
        news_alert_score_threshold=2,
    )
    repository = Repository(settings.database_path, settings.initial_cash)
    repository.initialize()
    provider = FakeProvider(
        [
            make_article("Market faces recession risk", now),
            make_article("Federal Reserve signals interest rate change", now),
        ]
    )
    notifier = RecordingNotifier()
    monitor = NewsMonitor(
        settings=settings,
        repository=repository,
        provider=provider,
        notifier=notifier,
        clock=lambda: now,
    )

    monitor.run()
    assert len(notifier.sent) == 1
    monitor.run()
    assert len(notifier.sent) == 1

    provider.articles.append(make_article("Stock market plunge triggers sell-off", now))
    monitor.run()
    assert len(notifier.sent) == 2
    assert notifier.sent[-1].significance_score == 4
