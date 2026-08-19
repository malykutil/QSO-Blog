import math
from datetime import UTC, datetime, timedelta

from stock_assistant.models import CandidateKind, IndicatorSnapshot, Position, ScreeningCandidate


def data_is_valid(
    snapshot: IndicatorSnapshot,
    *,
    now: datetime | None = None,
    max_age_minutes: int = 15,
) -> tuple[bool, str]:
    now = now or datetime.now(UTC)
    timestamp = snapshot.timestamp
    if timestamp.tzinfo is None:
        return False, "quote timestamp has no timezone"
    if timestamp > now + timedelta(minutes=1):
        return False, "quote timestamp is in the future"
    if now - timestamp.astimezone(UTC) > timedelta(minutes=max_age_minutes):
        return False, "quote is stale"

    numeric_values = snapshot.model_dump(exclude={"ticker", "timestamp", "bars"}).values()
    if any(not math.isfinite(float(value)) for value in numeric_values):
        return False, "snapshot contains a non-finite value"
    if snapshot.low > snapshot.high:
        return False, "bar low is above bar high"
    if not snapshot.low <= snapshot.current_price <= snapshot.high:
        return False, "current price is outside the latest bar"
    return True, "valid"


class DeterministicScreener:
    """Cheap first-pass screen. No LLM is used here."""

    def screen(
        self,
        snapshot: IndicatorSnapshot,
        position: Position | None = None,
        *,
        now: datetime | None = None,
        max_age_minutes: int = 15,
    ) -> ScreeningCandidate | None:
        valid, _ = data_is_valid(snapshot, now=now, max_age_minutes=max_age_minutes)
        if not valid:
            return None

        if position is not None:
            exit_triggers = []
            if snapshot.current_price < snapshot.ema20:
                exit_triggers.append("price below EMA20")
            if snapshot.rsi < 45:
                exit_triggers.append("RSI below 45")
            if snapshot.macd_histogram < 0:
                exit_triggers.append("negative MACD histogram")
            if exit_triggers:
                severity = sum(
                    [
                        max(0.0, (snapshot.ema20 - snapshot.current_price) / snapshot.atr),
                        max(0.0, (45 - snapshot.rsi) / 10),
                        1.0 if snapshot.macd_histogram < 0 else 0.0,
                    ]
                )
                return ScreeningCandidate(
                    snapshot=snapshot,
                    kind=CandidateKind.EXIT_REVIEW,
                    score=100 + severity,
                    screen_reason=", ".join(exit_triggers),
                )
            return None

        entry_rules = (
            snapshot.current_price > snapshot.ema20,
            snapshot.ema20 > snapshot.ema50,
            snapshot.ema50 > snapshot.ema200,
            50 <= snapshot.rsi <= 70,
            snapshot.macd > snapshot.macd_signal,
            snapshot.macd_histogram > 0,
            snapshot.relative_volume >= 1.2,
        )
        if not all(entry_rules):
            return None

        trend_strength = (snapshot.current_price - snapshot.ema20) / snapshot.atr
        score = (
            max(0.0, min(trend_strength, 5.0))
            + min(snapshot.relative_volume, 5.0)
            + min(max(snapshot.rsi - 50, 0) / 10, 2.0)
        )
        return ScreeningCandidate(
            snapshot=snapshot,
            kind=CandidateKind.ENTRY,
            score=score,
            screen_reason="bullish EMA stack, RSI 50-70, positive MACD, RVOL >= 1.2",
        )
