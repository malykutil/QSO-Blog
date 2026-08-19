from datetime import UTC, datetime

from stock_assistant.config import Settings
from stock_assistant.db import Repository
from stock_assistant.models import Action, TradeAnalysis
from stock_assistant.paper import PaperBroker
from stock_assistant.runner import TradingCycle
from stock_assistant.screening import DeterministicScreener
from stock_assistant.telegram import TelegramNotifier


class FakeUniverse:
    def get_symbols(self, override=None):
        return ["PASS", "FAIL"]


class FakeMarketData:
    def fetch(self, symbols):
        return {symbol: object() for symbol in symbols}


class RecordingAnalyzer:
    def __init__(self):
        self.tickers = []

    def analyze(self, candidate, position=None, news=None):
        self.tickers.append(candidate.snapshot.ticker)
        return TradeAnalysis(
            ticker=candidate.snapshot.ticker,
            action=Action.WATCH,
            confidence=0.5,
            entry_low=None,
            entry_high=None,
            stop_loss=None,
            target_1=None,
            target_2=None,
            risk_reward=None,
            reason="wait",
            risks=["test"],
        )


def test_only_screened_stock_reaches_llm(tmp_path, snapshot, monkeypatch):
    settings = Settings(
        database_path=tmp_path / "paper.db",
        universe_cache_path=tmp_path / "universe.json",
        run_outside_market_hours=True,
    )
    repository = Repository(settings.database_path, settings.initial_cash)
    repository.initialize()
    analyzer = RecordingAnalyzer()
    broker = PaperBroker(repository)
    notifier = TelegramNotifier(repository, None, None)
    fixed_now = datetime(2026, 8, 19, 15, 0, tzinfo=UTC)

    def fake_snapshot(ticker, _frame):
        if ticker == "PASS":
            return snapshot.model_copy(update={"ticker": "PASS"})
        return snapshot.model_copy(update={"ticker": "FAIL", "relative_volume": 1.0})

    monkeypatch.setattr("stock_assistant.runner.build_snapshot", fake_snapshot)
    cycle = TradingCycle(
        settings=settings,
        repository=repository,
        universe=FakeUniverse(),
        market_data=FakeMarketData(),
        screener=DeterministicScreener(),
        analyzer=analyzer,
        broker=broker,
        notifier=notifier,
        clock=lambda: fixed_now,
    )
    cycle.run()
    assert analyzer.tickers == ["PASS"]


def test_protective_exit_cannot_reenter_on_same_bar(tmp_path, snapshot, monkeypatch):
    settings = Settings(
        database_path=tmp_path / "paper.db",
        universe_cache_path=tmp_path / "universe.json",
        run_outside_market_hours=True,
    )
    repository = Repository(settings.database_path, settings.initial_cash)
    repository.initialize()
    repository.open_position(
        ticker="PASS",
        quantity=10,
        price=90,
        stop_loss=80,
        target_1=95,
        target_2=99,
        reason="existing paper position",
    )
    analyzer = RecordingAnalyzer()
    fixed_now = datetime(2026, 8, 19, 15, 0, tzinfo=UTC)

    def fake_snapshot(ticker, _frame):
        return snapshot.model_copy(update={"ticker": ticker})

    monkeypatch.setattr("stock_assistant.runner.build_snapshot", fake_snapshot)
    cycle = TradingCycle(
        settings=settings,
        repository=repository,
        universe=FakeUniverse(),
        market_data=FakeMarketData(),
        screener=DeterministicScreener(),
        analyzer=analyzer,
        broker=PaperBroker(repository),
        notifier=TelegramNotifier(repository, None, None),
        clock=lambda: fixed_now,
    )
    cycle.run()
    assert repository.get_positions() == {}
    assert "PASS" not in analyzer.tickers
