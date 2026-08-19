import pytest

from stock_assistant.db import Repository
from stock_assistant.models import Action, TradeAnalysis
from stock_assistant.paper import PaperBroker


def make_buy() -> TradeAnalysis:
    return TradeAnalysis(
        ticker="TEST",
        action=Action.BUY,
        confidence=0.8,
        entry_low=99,
        entry_high=101,
        stop_loss=96,
        target_1=110,
        target_2=115,
        risk_reward=2.5,
        reason="paper setup",
        risks=["market"],
    )


def test_paper_buy_and_sell_are_transactional(tmp_path, snapshot):
    repository = Repository(tmp_path / "paper.db", 100_000)
    repository.initialize()
    broker = PaperBroker(repository)

    execution, reason = broker.process(make_buy(), snapshot, {"TEST": 100})
    assert execution is not None
    assert reason == "paper BUY executed"
    assert execution.quantity == 250
    assert repository.get_cash() == pytest.approx(75_000)
    assert repository.get_positions()["TEST"].stop_loss == 96

    sell = TradeAnalysis(
        ticker="TEST",
        action=Action.SELL,
        confidence=0.9,
        entry_low=None,
        entry_high=None,
        stop_loss=None,
        target_1=None,
        target_2=None,
        risk_reward=None,
        reason="exit",
        risks=[],
    )
    exit_snapshot = snapshot.model_copy(
        update={"current_price": 105.0, "close": 105.0, "high": 106.0, "low": 104.0}
    )
    execution, reason = broker.process(sell, exit_snapshot, {"TEST": 105})
    assert execution is not None
    assert reason == "paper SELL executed"
    assert execution.realized_pnl == pytest.approx(1_250)
    assert repository.get_cash() == pytest.approx(101_250)
    assert repository.get_positions() == {}


def test_stop_loss_is_enforced_without_llm(tmp_path, snapshot):
    repository = Repository(tmp_path / "paper.db", 100_000)
    repository.initialize()
    broker = PaperBroker(repository)
    broker.process(make_buy(), snapshot, {"TEST": 100})

    execution = broker.protective_exit("TEST", 95.5)
    assert execution is not None
    assert execution.side == "SELL"
    assert "stop-loss" in execution.reason


def test_no_buy_when_stop_is_missing(tmp_path, snapshot):
    repository = Repository(tmp_path / "paper.db", 100_000)
    repository.initialize()
    broker = PaperBroker(repository)
    unsafe = make_buy().model_copy(update={"stop_loss": None})
    execution, reason = broker.process(unsafe, snapshot, {"TEST": 100})
    assert execution is None
    assert "requires" in reason
    assert repository.get_positions() == {}


def test_existing_paper_position_can_be_imported_with_risk_guard(tmp_path):
    repository = Repository(tmp_path / "paper.db", 100_000)
    repository.initialize()
    broker = PaperBroker(repository)
    execution = broker.import_existing_position(
        ticker="aapl",
        quantity=10,
        entry_price=220,
        stop_loss=215,
        target_1=233,
        target_2=240,
    )
    assert execution.ticker == "AAPL"
    assert repository.get_positions()["AAPL"].quantity == 10

    with pytest.raises(ValueError, match="překračuje 1%"):
        broker.import_existing_position(
            ticker="MSFT",
            quantity=1_000,
            entry_price=500,
            stop_loss=490,
            target_1=525,
            target_2=540,
        )
