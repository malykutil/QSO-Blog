import pytest

from stock_assistant.models import Action, TradeAnalysis
from stock_assistant.risk import calculate_position_size, validate_analysis


def buy_analysis(**updates) -> TradeAnalysis:
    payload = {
        "ticker": "TEST",
        "action": Action.BUY,
        "confidence": 0.8,
        "entry_low": 99.0,
        "entry_high": 101.0,
        "stop_loss": 96.0,
        "target_1": 110.0,
        "target_2": 115.0,
        "risk_reward": 3.0,
        "reason": "setup",
        "risks": ["market"],
    }
    payload.update(updates)
    return TradeAnalysis(**payload)


def test_server_recalculates_rr_from_authoritative_price(snapshot):
    analysis = buy_analysis(risk_reward=99.0)
    valid, _ = validate_analysis(
        analysis, snapshot, min_risk_reward=2.5, has_position=False
    )
    assert valid
    assert analysis.risk_reward == pytest.approx(2.5)


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"stop_loss": None}, "requires"),
        ({"stop_loss": 100.0}, "below"),
        ({"target_1": 109.9}, "below 2.50"),
        ({"entry_low": 101.0, "entry_high": 102.0}, "outside"),
        ({"ticker": "OTHER"}, "does not match"),
    ],
)
def test_unsafe_buy_is_rejected(snapshot, updates, message):
    valid, reason = validate_analysis(
        buy_analysis(**updates), snapshot, min_risk_reward=2.5, has_position=False
    )
    assert not valid
    assert message in reason


def test_position_size_never_exceeds_one_percent_risk():
    quantity = calculate_position_size(
        equity=100_000,
        cash=100_000,
        entry_price=100,
        stop_loss=96,
        max_risk_fraction=0.01,
    )
    assert quantity == 250
    assert quantity * (100 - 96) <= 1_000


def test_position_size_respects_available_cash():
    assert calculate_position_size(
        equity=100_000,
        cash=450,
        entry_price=100,
        stop_loss=99,
        max_risk_fraction=0.01,
    ) == 4


def test_structured_schema_requires_every_requested_key():
    required = set(TradeAnalysis.model_json_schema()["required"])
    assert required == {
        "ticker",
        "action",
        "confidence",
        "entry_low",
        "entry_high",
        "stop_loss",
        "target_1",
        "target_2",
        "risk_reward",
        "reason",
        "risks",
    }
