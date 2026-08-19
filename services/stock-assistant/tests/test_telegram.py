from datetime import UTC, datetime

from stock_assistant.db import Repository
from stock_assistant.models import Action, Position, TradeExecution
from stock_assistant.telegram import TelegramNotifier


def execution(price: float) -> TradeExecution:
    return TradeExecution(
        ticker="TEST",
        side="BUY",
        quantity=10,
        price=price,
        reason="test",
        executed_at=datetime.now(UTC),
    )


def test_non_meaningful_repeat_is_suppressed(tmp_path):
    repository = Repository(tmp_path / "paper.db", 100_000)
    repository.initialize()
    repository.record_alert("TEST", Action.BUY, 100, 96, 110, "old")
    notifier = TelegramNotifier(repository, "token", "chat", change_threshold=0.005)

    assert not notifier.is_meaningful(execution(100.2), 96.2, 110.2)
    assert notifier.is_meaningful(execution(101.0), 96.2, 110.2)
    assert notifier.is_meaningful(
        execution(100.2).model_copy(update={"side": "SELL"}), None, None
    )


def test_disabled_telegram_does_not_record_fake_delivery(tmp_path):
    repository = Repository(tmp_path / "paper.db", 100_000)
    repository.initialize()
    notifier = TelegramNotifier(repository, None, None)
    assert not notifier.send_execution(execution(100))
    assert repository.last_alert("TEST") is None


def test_position_updates_send_first_then_require_meaningful_change(tmp_path, monkeypatch):
    repository = Repository(tmp_path / "paper.db", 100_000)
    repository.initialize()
    notifier = TelegramNotifier(
        repository, "token", "chat", position_update_threshold=0.005
    )
    position = Position(
        ticker="TEST",
        quantity=10,
        entry_price=100,
        stop_loss=96,
        target_1=110,
        target_2=115,
        opened_at=datetime.now(UTC),
    )

    class Response:
        def raise_for_status(self):
            return None

    sent_messages = []

    def fake_post(_url, *, json, timeout):
        sent_messages.append(json["text"])
        return Response()

    monkeypatch.setattr("stock_assistant.telegram.httpx.post", fake_post)
    timestamp = datetime.now(UTC)
    assert notifier.send_position_update(position, 101.0, timestamp)
    assert "Nerealizovaný výsledek: +10.00 USD (+1.00 %)" in sent_messages[-1]

    assert not notifier.send_position_update(position, 101.2, timestamp)
    assert len(sent_messages) == 1

    assert notifier.send_position_update(position, 102.0, timestamp)
    assert len(sent_messages) == 2
