from fastapi.testclient import TestClient

from stock_assistant.agent_league import AgentLeague
from stock_assistant.config import Settings
from stock_assistant.dashboard import create_dashboard_app
from stock_assistant.db import Repository


def make_client(tmp_path):
    settings = Settings(
        database_path=tmp_path / "paper.db",
        universe_cache_path=tmp_path / "universe.json",
        log_path=tmp_path / "assistant.log",
        agent_initial_cash=10_000,
    )
    repository = Repository(
        settings.database_path,
        settings.initial_cash,
        settings.agent_initial_cash,
        settings.agent_min_score,
    )
    repository.initialize()
    return TestClient(create_dashboard_app(repository, settings)), repository, settings


def test_czech_dashboard_and_api_are_available(tmp_path):
    client, _, _ = make_client(tmp_path)

    page = client.get("/")
    payload = client.get("/api/dashboard")
    health = client.get("/api/health")

    assert page.status_code == 200
    assert "Osm strategií" in page.text
    assert payload.status_code == 200
    assert payload.json()["mode"] == "PAPER"
    assert payload.json()["engine"]["data_source"] == "Yahoo Finance OHLCV"
    assert payload.json()["engine"]["interval"] == "5m"
    assert set(payload.json()["engine"]["markets"]) == {"US", "EU"}
    assert payload.json()["engine"]["markets"]["US"]["calendar"] == "NYSE"
    assert payload.json()["engine"]["markets"]["EU"]["calendar"] == "XETR"
    assert isinstance(payload.json()["engine"]["markets"]["US"]["is_open"], bool)
    assert len(payload.json()["agents"]) == 8
    assert {agent["market"] for agent in payload.json()["agents"]} == {"US", "EU"}
    aggressive = [
        agent for agent in payload.json()["agents"]
        if agent["risk_profile"] == "HIGH_VOLATILITY"
    ]
    assert {agent["market"] for agent in aggressive} == {"US", "EU"}
    assert all(agent["risk_per_trade_percent"] == 0.5 for agent in aggressive)
    assert all(agent["max_portfolio_risk_percent"] == 5 for agent in aggressive)
    assert all(agent["learning"]["policy_version"] == 1 for agent in payload.json()["agents"])
    assert all(agent["learning"]["trades_learned"] == 0 for agent in payload.json()["agents"])
    assert health.json() == {"ok": True, "mode": "PAPER"}


def test_dashboard_allows_private_browser_bridge_only_for_configured_origin(tmp_path):
    client, _, _ = make_client(tmp_path)
    allowed_origin = "https://ok2mkj.vercel.app"

    response = client.get("/api/dashboard", headers={"Origin": allowed_origin})
    rejected = client.get(
        "/api/dashboard", headers={"Origin": "https://example.invalid"}
    )
    preflight = client.options(
        "/api/dashboard",
        headers={
            "Origin": allowed_origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Private-Network": "true",
        },
    )

    assert response.headers["access-control-allow-origin"] == allowed_origin
    assert "access-control-allow-origin" not in rejected.headers
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-private-network"] == "true"


def test_capital_api_refuses_silent_history_deletion(tmp_path, snapshot):
    client, repository, settings = make_client(tmp_path)
    AgentLeague(repository, settings).process({snapshot.ticker: snapshot})
    repository.save_instrument_names({snapshot.ticker: "Test Corporation"})
    agent_id = int(repository.get_agent_accounts("US")[0]["id"])

    dashboard = client.get("/api/dashboard").json()
    named_position = next(agent for agent in dashboard["agents"] if agent["id"] == agent_id)[
        "open_positions"
    ][0]
    assert named_position["company_name"] == "Test Corporation"

    rejected = client.put(
        f"/api/agents/{agent_id}/capital",
        json={"capital": 20_000, "reset_history": False},
    )
    accepted = client.put(
        f"/api/agents/{agent_id}/capital",
        json={"capital": 20_000, "reset_history": True},
    )

    assert rejected.status_code == 409
    assert accepted.status_code == 200
    assert accepted.json()["agent"]["equity"] == 20_000


def test_capital_api_can_rebase_without_deleting_paper_history(tmp_path, snapshot):
    client, repository, settings = make_client(tmp_path)
    AgentLeague(repository, settings).process({snapshot.ticker: snapshot})
    agent_id = int(repository.get_agent_accounts("US")[0]["id"])

    response = client.put(
        f"/api/agents/{agent_id}/capital",
        json={"capital": 100_000, "reset_history": False, "preserve_history": True},
    )

    assert response.status_code == 200
    state = repository.agent_runtime_state(agent_id)
    assert state["equity"] == 100_000
    assert len(state["positions"]) == 1
    assert repository.get_agent_learning_state(agent_id)["trades_learned"] == 0


def test_remote_dashboard_requires_bearer_token(tmp_path):
    settings = Settings(
        database_path=tmp_path / "paper.db",
        universe_cache_path=tmp_path / "universe.json",
        log_path=tmp_path / "assistant.log",
        dashboard_host="0.0.0.0",
        dashboard_api_token="secret-token-that-is-at-least-32-chars",
    )
    repository = Repository(settings.database_path, settings.initial_cash)
    repository.initialize()
    client = TestClient(create_dashboard_app(repository, settings))

    assert client.get("/api/health").status_code == 200
    assert client.get("/api/dashboard").status_code == 401
    response = client.get(
        "/api/dashboard",
        headers={"Authorization": f"Bearer {settings.dashboard_api_token}"},
    )
    assert response.status_code == 200
    assert len(response.json()["agents"]) == 8
