from datetime import UTC, datetime, timedelta

import pandas_market_calendars as mcal


def market_is_open(calendar_name: str, now: datetime | None = None) -> bool:
    current = (now or datetime.now(UTC)).astimezone(UTC)
    calendar = mcal.get_calendar(calendar_name)
    schedule = calendar.schedule(start_date=current.date(), end_date=current.date())
    if schedule.empty:
        return False
    market_open = schedule.iloc[0]["market_open"].to_pydatetime()
    market_close = schedule.iloc[0]["market_close"].to_pydatetime()
    return market_open <= current <= market_close


def market_session_status(
    calendar_name: str,
    code: str,
    name: str,
    now: datetime | None = None,
) -> dict[str, object]:
    """Return the current or next exchange session in UTC."""
    current = (now or datetime.now(UTC)).astimezone(UTC)
    calendar = mcal.get_calendar(calendar_name)
    schedule = calendar.schedule(
        start_date=current.date(),
        end_date=current.date() + timedelta(days=21),
    )
    upcoming = schedule[schedule["market_close"] >= current]
    if upcoming.empty:
        return {
            "code": code,
            "name": name,
            "calendar": calendar_name,
            "is_open": False,
            "opens_at": None,
            "closes_at": None,
        }

    session = upcoming.iloc[0]
    opens_at = session["market_open"].to_pydatetime().astimezone(UTC)
    closes_at = session["market_close"].to_pydatetime().astimezone(UTC)
    return {
        "code": code,
        "name": name,
        "calendar": calendar_name,
        "is_open": opens_at <= current <= closes_at,
        "opens_at": opens_at.isoformat(),
        "closes_at": closes_at.isoformat(),
    }


def market_overview(now: datetime | None = None) -> dict[str, dict[str, object]]:
    current = now or datetime.now(UTC)
    return {
        "EU": market_session_status("XETR", "EU", "Evropa · Xetra", current),
        "US": market_session_status("NYSE", "US", "USA · NYSE", current),
    }
