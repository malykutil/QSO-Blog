import hmac
import logging
from datetime import UTC, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field

from stock_assistant.agent_profiles import is_high_volatility_agent
from stock_assistant.config import Settings
from stock_assistant.db import Repository
from stock_assistant.market_hours import market_overview

logger = logging.getLogger(__name__)


class CapitalUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capital: float = Field(gt=0, le=1_000_000_000)
    reset_history: bool = False


def create_dashboard_app(repository: Repository, settings: Settings) -> FastAPI:
    app = FastAPI(
        title="AI Stock PAPER Assistant",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    allowed_origins = settings.dashboard_allowed_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "PUT", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        allow_private_network=True,
    )
    index_path = Path(__file__).resolve().parent / "web" / "index.html"

    def require_access(request: Request) -> None:
        expected = settings.dashboard_api_token
        if expected is None:
            return
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, f"Bearer {expected}"):
            raise HTTPException(status_code=401, detail="Neplatné oprávnění dashboardu")

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request) -> str:
        require_access(request)
        return index_path.read_text(encoding="utf-8")

    @app.get("/api/dashboard")
    def dashboard_data(request: Request) -> dict[str, object]:
        require_access(request)
        agents = repository.agent_dashboard()
        for agent in agents:
            high_volatility = is_high_volatility_agent(str(agent["slug"]))
            agent["risk_profile"] = "HIGH_VOLATILITY" if high_volatility else "STANDARD"
            agent["risk_per_trade_percent"] = 100 * (
                settings.agent_high_volatility_risk_per_trade
                if high_volatility
                else settings.agent_risk_per_trade
            )
            agent["max_portfolio_risk_percent"] = 100 * (
                settings.agent_high_volatility_max_portfolio_risk
                if high_volatility
                else settings.agent_max_portfolio_risk
            )
        main_account = repository.dump_account()
        recent_news = [
            article.model_dump(mode="json") for article in repository.recent_news(limit=8)
        ]
        latest_cycle = repository.latest_cycle()
        return {
            "mode": settings.trading_mode.upper(),
            "scanner_interval_minutes": 5,
            "server_time": datetime.now(UTC).isoformat(),
            "engine": {
                "data_source": "Yahoo Finance OHLCV",
                "interval": settings.market_data_interval,
                "last_cycle": latest_cycle,
                "markets": market_overview(),
            },
            "main_account": main_account,
            "agents": agents,
            "recent_news": recent_news,
        }

    @app.put("/api/agents/{agent_id}/capital")
    def update_capital(
        agent_id: int,
        payload: CapitalUpdate,
        request: Request,
    ) -> dict[str, object]:
        require_access(request)
        try:
            repository.reset_agent_capital(
                agent_id,
                payload.capital,
                reset_history=payload.reset_history,
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        logger.info(
            "Agent capital updated agent_id=%d reset_history=%s",
            agent_id,
            payload.reset_history,
        )
        agent = next(
            item for item in repository.agent_dashboard() if int(item["id"]) == agent_id
        )
        return {"ok": True, "agent": agent}

    @app.get("/api/health")
    def health() -> dict[str, object]:
        return {"ok": repository.healthcheck(), "mode": settings.trading_mode.upper()}

    return app
