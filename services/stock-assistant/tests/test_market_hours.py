from datetime import UTC, datetime

from stock_assistant.market_hours import market_is_open, market_overview


def test_market_overview_distinguishes_europe_and_us_sessions():
    now = datetime(2026, 8, 19, 10, 0, tzinfo=UTC)

    markets = market_overview(now)

    assert markets["EU"]["is_open"] is True
    assert markets["US"]["is_open"] is False
    assert markets["EU"]["calendar"] == "XETR"
    assert markets["US"]["calendar"] == "NYSE"
    assert markets["US"]["opens_at"] == "2026-08-19T13:30:00+00:00"
    assert markets["US"]["closes_at"] == "2026-08-19T20:00:00+00:00"


def test_market_overview_uses_next_session_on_weekend():
    now = datetime(2026, 8, 22, 12, 0, tzinfo=UTC)

    markets = market_overview(now)

    assert markets["EU"]["is_open"] is False
    assert markets["US"]["is_open"] is False
    assert str(markets["EU"]["opens_at"]).startswith("2026-08-24T07:00:00")
    assert str(markets["US"]["opens_at"]).startswith("2026-08-24T13:30:00")
    assert market_is_open("NYSE", now) is False
