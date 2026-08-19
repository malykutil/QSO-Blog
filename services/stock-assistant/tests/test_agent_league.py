import sqlite3

import pytest

from stock_assistant.agent_league import (
    AgentLeague,
    high_volatility_accepts,
    high_volatility_score,
    score_snapshot,
    strategy_accepts,
)
from stock_assistant.config import Settings
from stock_assistant.db import Repository


def make_league(tmp_path):
    settings = Settings(
        database_path=tmp_path / "paper.db",
        universe_cache_path=tmp_path / "universe.json",
        log_path=tmp_path / "assistant.log",
        agent_initial_cash=10_000,
        agent_risk_per_trade=0.005,
        agent_max_portfolio_risk=0.02,
        agent_max_symbol_exposure=0.20,
        agent_min_score=75,
    )
    repository = Repository(
        settings.database_path,
        settings.initial_cash,
        settings.agent_initial_cash,
        settings.agent_min_score,
    )
    repository.initialize()
    return repository, settings, AgentLeague(repository, settings)


def test_repository_creates_eight_isolated_regional_paper_agents(tmp_path):
    repository, _, _ = make_league(tmp_path)

    accounts = repository.get_agent_accounts()

    assert [account["strategy"] for account in accounts] == [
        "TREND",
        "BREAKOUT",
        "MOMENTUM",
        "HYBRID",
        "TREND",
        "BREAKOUT",
        "MOMENTUM",
        "HYBRID",
    ]
    assert [account["market"] for account in accounts] == ["US"] * 4 + ["EU"] * 4
    assert [account["currency"] for account in accounts] == ["USD"] * 4 + ["EUR"] * 4
    assert all(account["initial_cash"] == 10_000 for account in accounts)
    assert all(account["cash"] == 10_000 for account in accounts)


def test_existing_four_agent_database_migrates_without_losing_cash(tmp_path):
    database = tmp_path / "legacy.db"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """CREATE TABLE agent_accounts (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   slug TEXT NOT NULL UNIQUE,
                   name TEXT NOT NULL,
                   strategy TEXT NOT NULL,
                   initial_cash REAL NOT NULL,
                   cash REAL NOT NULL,
                   enabled INTEGER NOT NULL,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
               )"""
        )
        connection.execute(
            """INSERT INTO agent_accounts
               (slug, name, strategy, initial_cash, cash, enabled, created_at, updated_at)
               VALUES ('trend', 'Trend', 'TREND', 10000, 9876, 1, 'old', 'old')"""
        )

    repository = Repository(database, 100_000, 10_000, 75, 10_000)
    repository.initialize()
    accounts = repository.get_agent_accounts()
    migrated = next(account for account in accounts if account["slug"] == "trend")

    assert len(accounts) == 8
    assert migrated["cash"] == 9_876
    assert migrated["market"] == "US"
    assert migrated["currency"] == "USD"


def test_all_strategies_accept_strong_fixture(snapshot):
    score = score_snapshot(snapshot)

    assert score == 100
    assert all(
        strategy_accepts(strategy, snapshot, score)
        for strategy in ("TREND", "BREAKOUT", "MOMENTUM", "HYBRID")
    )


def test_agent_league_opens_risk_limited_positions_and_closes_at_stop(
    tmp_path,
    snapshot,
):
    repository, _, league = make_league(tmp_path)

    league.process({snapshot.ticker: snapshot})

    for account in repository.get_agent_accounts("US"):
        state = repository.agent_runtime_state(int(account["id"]))
        assert len(state["positions"]) == 1
        position = state["positions"][0]
        if account["slug"] == "momentum":
            assert position["quantity"] == 25
            assert position["stop_loss"] == pytest.approx(96)
            assert position["target_1"] == pytest.approx(110)
            assert position["target_2"] == pytest.approx(120)
            assert state["portfolio_risk"] <= state["equity"] * 0.01
        else:
            assert position["quantity"] == 16
            assert position["stop_loss"] == pytest.approx(97)
            assert position["target_1"] == pytest.approx(107.5)
            assert position["target_2"] == pytest.approx(112)
            assert state["portfolio_risk"] <= state["equity"] * 0.005

    league.process({snapshot.ticker: snapshot})
    assert all(
        len(repository.get_agent_positions(int(account["id"]))) == 1
        for account in repository.get_agent_accounts("US")
    )

    stopped = snapshot.model_copy(
        update={
            "current_price": 96,
            "close": 96,
            "open": 97,
            "high": 97.5,
            "low": 95.5,
            "distance_ema20": -2.04,
            "momentum_20": -3,
            "relative_volume": 1.0,
            "macd_histogram": -0.2,
        }
    )
    league.process({stopped.ticker: stopped})

    for agent in repository.agent_dashboard():
        if agent["market"] != "US":
            continue
        assert agent["open_positions"] == []
        expected_loss = -100 if agent["slug"] == "momentum" else -64
        assert agent["realized_pnl"] == pytest.approx(expected_loss)
        assert agent["equity"] == pytest.approx(10_000 + expected_loss)
        assert agent["learning"]["trades_learned"] == 1
        assert agent["learning"]["losses"] == 1
        assert agent["learning"]["wins"] == 0
        assert agent["learning"]["policy_version"] == 2
        assert (
            agent["learning"]["decision_threshold"]
            > agent["learning"]["base_threshold"]
        )
        assert "Ztráta" in agent["learning"]["recent_lessons"][0]["lesson"]


def test_agent_league_learns_from_a_target_win(tmp_path, snapshot):
    repository, _, league = make_league(tmp_path)
    league.process({snapshot.ticker: snapshot})

    target = snapshot.model_copy(
        update={
            "current_price": 121,
            "close": 121,
            "open": 120,
            "high": 122,
            "low": 111,
            "distance_ema20": 23.47,
        }
    )
    league.process({target.ticker: target})

    for agent in repository.agent_dashboard():
        if agent["market"] != "US":
            continue
        learning = agent["learning"]
        assert agent["open_positions"] == []
        expected_profit = 525 if agent["slug"] == "momentum" else 336
        assert agent["realized_pnl"] == pytest.approx(expected_profit)
        assert learning["trades_learned"] == 1
        assert learning["wins"] == 1
        assert learning["losses"] == 0
        expected_reward = 525 / 100 if agent["slug"] == "momentum" else 336 / 48
        assert learning["last_reward_r"] == pytest.approx(expected_reward)
        assert learning["decision_threshold"] < learning["base_threshold"]
        assert "Zisk" in learning["recent_lessons"][0]["lesson"]


def test_high_volatility_profile_requires_real_atr_and_ranks_it_higher(snapshot):
    volatile = snapshot.model_copy(update={"atr": 4.0, "relative_volume": 2.2})
    calm = snapshot.model_copy(update={"atr": 0.8})

    assert high_volatility_accepts(volatile, volatility_floor=2.5)
    assert not high_volatility_accepts(calm, volatility_floor=1.5)
    assert high_volatility_score(volatile) > high_volatility_score(calm)


def test_capital_change_requires_explicit_history_reset(tmp_path, snapshot):
    repository, _, league = make_league(tmp_path)
    league.process({snapshot.ticker: snapshot})
    agent_id = int(repository.get_agent_accounts("US")[0]["id"])

    with pytest.raises(ValueError, match="historii nebo pozice"):
        repository.reset_agent_capital(agent_id, 25_000, reset_history=False)

    repository.reset_agent_capital(agent_id, 25_000, reset_history=True)
    state = repository.agent_runtime_state(agent_id)
    dashboard = next(item for item in repository.agent_dashboard() if item["id"] == agent_id)
    assert state["cash"] == 25_000
    assert state["equity"] == 25_000
    assert state["positions"] == []
    assert dashboard["recent_trades"] == []
    assert dashboard["equity_curve"] == []
    assert dashboard["learning"]["trades_learned"] == 0
    assert dashboard["learning"]["policy_version"] == 1
    assert dashboard["learning"]["recent_lessons"] == []


def test_europe_cycle_trades_only_european_accounts(tmp_path, snapshot):
    repository, _, league = make_league(tmp_path)
    european = snapshot.model_copy(update={"ticker": "ADS.DE"})

    league.process({european.ticker: european}, market="EU")

    us_accounts = repository.get_agent_accounts("US")
    eu_accounts = repository.get_agent_accounts("EU")
    assert all(
        repository.get_agent_positions(int(account["id"])) == []
        for account in us_accounts
    )
    assert all(
        len(repository.get_agent_positions(int(account["id"]))) == 1
        for account in eu_accounts
    )
