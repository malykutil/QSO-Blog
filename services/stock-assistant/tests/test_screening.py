from datetime import timedelta

from stock_assistant.models import CandidateKind
from stock_assistant.screening import DeterministicScreener, data_is_valid


def test_bullish_snapshot_passes_without_llm(snapshot, now):
    candidate = DeterministicScreener().screen(snapshot, now=now)
    assert candidate is not None
    assert candidate.kind == CandidateKind.ENTRY


def test_stale_or_invalid_data_fails_closed(snapshot, now):
    stale = snapshot.model_copy(update={"timestamp": now - timedelta(minutes=16)})
    valid, reason = data_is_valid(stale, now=now, max_age_minutes=15)
    assert not valid
    assert "stale" in reason
    assert DeterministicScreener().screen(stale, now=now) is None

    impossible = snapshot.model_copy(update={"current_price": 102.0})
    valid, reason = data_is_valid(impossible, now=now)
    assert not valid
    assert "outside" in reason


def test_failed_technical_rule_does_not_pass(snapshot, now):
    weak_volume = snapshot.model_copy(update={"relative_volume": 1.19})
    assert DeterministicScreener().screen(weak_volume, now=now) is None
