from stock_assistant.db import Repository
from stock_assistant.paper import PaperBroker
from stock_assistant.telegram_commands import OFFSET_STATE_KEY, TelegramCommandService


class FakeNotifier:
    def __init__(self):
        self.messages = []

    def send_text(self, message):
        self.messages.append(message)
        return True


class FakeResponse:
    def __init__(self, updates):
        self.updates = updates

    def raise_for_status(self):
        return None

    def json(self):
        return {"ok": True, "result": self.updates}


def make_service(tmp_path):
    repository = Repository(tmp_path / "paper.db", 100_000)
    repository.initialize()
    notifier = FakeNotifier()
    service = TelegramCommandService(
        repository=repository,
        broker=PaperBroker(repository),
        notifier=notifier,
        bot_token="token",
        allowed_chat_id="123",
    )
    return service, repository, notifier


def update(text, *, chat_id=123, update_id=1):
    return {
        "update_id": update_id,
        "message": {"chat": {"id": chat_id, "type": "private"}, "text": text},
    }


def test_authorized_add_command_imports_guarded_position(tmp_path, monkeypatch):
    service, repository, notifier = make_service(tmp_path)
    monkeypatch.setattr(
        "stock_assistant.telegram_commands.httpx.get",
        lambda *args, **kwargs: FakeResponse([update("/add AAPL 10 220 215 233 240")]),
    )
    service.poll_once()

    position = repository.get_positions()["AAPL"]
    assert position.quantity == 10
    assert position.stop_loss == 215
    assert repository.get_state(OFFSET_STATE_KEY) == "2"
    assert "PAPER POZICE PŘIDÁNA: AAPL" in notifier.messages[-1]


def test_unauthorized_chat_is_ignored_but_offset_advances(tmp_path, monkeypatch):
    service, repository, notifier = make_service(tmp_path)
    monkeypatch.setattr(
        "stock_assistant.telegram_commands.httpx.get",
        lambda *args, **kwargs: FakeResponse(
            [update("/add AAPL 10 220 215 233 240", chat_id=999, update_id=8)]
        ),
    )
    service.poll_once()

    assert repository.get_positions() == {}
    assert notifier.messages == []
    assert repository.get_state(OFFSET_STATE_KEY) == "9"


def test_invalid_risk_is_reported_without_position(tmp_path, monkeypatch):
    service, repository, notifier = make_service(tmp_path)
    monkeypatch.setattr(
        "stock_assistant.telegram_commands.httpx.get",
        lambda *args, **kwargs: FakeResponse(
            [update("/add AAPL 1000 220 200 280 300")]
        ),
    )
    service.poll_once()

    assert repository.get_positions() == {}
    assert "překračuje 1%" in notifier.messages[-1]


def test_positions_and_status_commands_reply(tmp_path, monkeypatch):
    service, repository, notifier = make_service(tmp_path)
    updates = [update("/positions", update_id=1), update("/status", update_id=2)]
    monkeypatch.setattr(
        "stock_assistant.telegram_commands.httpx.get",
        lambda *args, **kwargs: FakeResponse(updates),
    )
    service.poll_once()

    assert "Žádné otevřené pozice" in notifier.messages[0]
    assert "Otevřené pozice: 0" in notifier.messages[1]
    assert repository.get_state(OFFSET_STATE_KEY) == "3"


def test_news_command_reports_empty_store(tmp_path, monkeypatch):
    service, repository, notifier = make_service(tmp_path)
    monkeypatch.setattr(
        "stock_assistant.telegram_commands.httpx.get",
        lambda *args, **kwargs: FakeResponse([update("/news")]),
    )
    service.poll_once()
    assert notifier.messages == ["ZPRÁVY\nZatím nebyly načteny žádné zprávy."]
    assert repository.get_state(OFFSET_STATE_KEY) == "2"
