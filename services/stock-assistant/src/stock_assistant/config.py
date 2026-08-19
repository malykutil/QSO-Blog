from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    trading_mode: Literal["paper"] = "paper"
    openai_api_key: str | None = None
    openai_model: str = "gpt-5.4-mini"
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None

    database_path: Path = Path("data/stock_assistant.db")
    universe_cache_path: Path = Path("data/universe.json")
    europe_universe_cache_path: Path = Path("data/europe_universe.json")
    log_path: Path = Path("logs/assistant.log")
    log_level: str = "INFO"
    initial_cash: float = Field(default=100_000.0, gt=0)
    agent_initial_cash: float = Field(default=10_000.0, gt=0)
    agent_europe_initial_cash: float = Field(default=10_000.0, gt=0)
    agent_risk_per_trade: float = Field(default=0.005, ge=0.0025, le=0.01)
    agent_max_portfolio_risk: float = Field(default=0.02, gt=0, le=0.05)
    agent_max_positions: int = Field(default=5, ge=1, le=20)
    agent_max_symbol_exposure: float = Field(default=0.20, gt=0, le=0.50)
    agent_min_score: int = Field(default=75, ge=50, le=100)
    agent_learning_rate: float = Field(default=0.12, ge=0.01, le=0.50)
    dashboard_host: str = "127.0.0.1"
    dashboard_port: int = Field(default=8765, ge=1024, le=65535)
    dashboard_api_token: str | None = Field(default=None, min_length=32)
    dashboard_cors_origins: str = (
        "https://ok2mkj.vercel.app,http://localhost:3000,http://127.0.0.1:3000"
    )
    max_risk_per_trade: float = Field(default=0.01, gt=0, le=0.01)
    min_risk_reward: float = Field(default=2.5, ge=2.5)
    max_llm_candidates: int = Field(default=15, ge=1, le=100)
    max_quote_age_minutes: int = Field(default=15, ge=1, le=120)
    europe_max_quote_age_minutes: int = Field(default=30, ge=15, le=120)
    market_data_batch_size: int = Field(default=50, ge=1, le=200)
    market_data_period: str = "10d"
    market_data_interval: str = "5m"
    universe_cache_hours: int = Field(default=24, ge=1, le=168)
    position_update_threshold: float = Field(default=0.005, gt=0, le=0.1)
    telegram_poll_seconds: int = Field(default=10, ge=5, le=300)
    news_enabled: bool = True
    news_poll_minutes: int = Field(default=5, ge=1, le=60)
    news_max_age_hours: int = Field(default=24, ge=1, le=168)
    news_max_per_query: int = Field(default=10, ge=1, le=50)
    news_alert_score_threshold: int = Field(default=2, ge=1, le=10)
    news_bootstrap_alerts: int = Field(default=1, ge=0, le=5)
    news_max_alerts_per_cycle: int = Field(default=3, ge=1, le=10)
    news_global_query: str = 'NASDAQ OR "S&P 500" stock market when:1d'
    run_outside_market_hours: bool = False
    universe_override: str | None = None
    europe_universe_override: str | None = None

    @field_validator(
        "openai_api_key",
        "telegram_bot_token",
        "telegram_chat_id",
        "dashboard_api_token",
        mode="before",
    )
    @classmethod
    def empty_string_is_none(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @field_validator("dashboard_host")
    @classmethod
    def dashboard_host_must_be_explicit(cls, value: str) -> str:
        if value not in {"127.0.0.1", "localhost", "0.0.0.0"}:
            raise ValueError("DASHBOARD_HOST must be local or the explicit container bind address")
        return value

    @model_validator(mode="after")
    def telegram_credentials_are_complete(self) -> "Settings":
        if bool(self.telegram_bot_token) != bool(self.telegram_chat_id):
            raise ValueError("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together")
        if self.dashboard_host == "0.0.0.0" and not self.dashboard_api_token:
            raise ValueError("DASHBOARD_API_TOKEN is required for a network-accessible dashboard")
        return self

    @property
    def override_symbols(self) -> list[str] | None:
        if not self.universe_override:
            return None
        return sorted({item.strip().upper() for item in self.universe_override.split(",") if item})

    @property
    def europe_override_symbols(self) -> list[str] | None:
        if not self.europe_universe_override:
            return None
        return sorted(
            {
                item.strip().upper()
                for item in self.europe_universe_override.split(",")
                if item.strip()
            }
        )

    @property
    def dashboard_allowed_origins(self) -> list[str]:
        return sorted(
            {
                item.strip().rstrip("/")
                for item in self.dashboard_cors_origins.split(",")
                if item.strip()
            }
        )

    def ensure_directories(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.universe_cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.europe_universe_cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
