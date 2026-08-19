from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Action(StrEnum):
    BUY = "BUY"
    WATCH = "WATCH"
    HOLD = "HOLD"
    SELL = "SELL"


class CandidateKind(StrEnum):
    ENTRY = "ENTRY"
    EXIT_REVIEW = "EXIT_REVIEW"


class IndicatorSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticker: str
    timestamp: datetime
    current_price: float = Field(gt=0)
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float = Field(gt=0)
    ema20: float = Field(gt=0)
    ema50: float = Field(gt=0)
    ema200: float = Field(gt=0)
    rsi: float = Field(ge=0, le=100)
    macd: float
    macd_signal: float
    macd_histogram: float
    atr: float = Field(gt=0)
    relative_volume: float = Field(gt=0)
    average_volume_20: float = Field(gt=0)
    recent_high_20: float = Field(gt=0)
    recent_low_20: float = Field(gt=0)
    momentum_20: float
    gap_percent: float
    distance_ema20: float
    trend_strength: float
    bars: int = Field(ge=200)


class ScreeningCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot: IndicatorSnapshot
    kind: CandidateKind
    score: float
    screen_reason: str


class TradeAnalysis(BaseModel):
    """Exact schema requested from the model; nullable levels remain required JSON keys."""

    model_config = ConfigDict(extra="forbid")

    ticker: str
    action: Action
    confidence: float = Field(ge=0, le=1)
    entry_low: float | None
    entry_high: float | None
    stop_loss: float | None
    target_1: float | None
    target_2: float | None
    risk_reward: float | None
    reason: str = Field(min_length=1, max_length=1000)
    risks: list[str] = Field(max_length=10)

    @field_validator("ticker")
    @classmethod
    def normalize_ticker(cls, value: str) -> str:
        value = value.strip().upper()
        if not value:
            raise ValueError("ticker cannot be empty")
        return value


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticker: str
    quantity: int = Field(gt=0)
    entry_price: float = Field(gt=0)
    stop_loss: float = Field(gt=0)
    target_1: float = Field(gt=0)
    target_2: float = Field(gt=0)
    opened_at: datetime


class TradeExecution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ticker: str
    side: Literal["BUY", "SELL"]
    quantity: int = Field(gt=0)
    price: float = Field(gt=0)
    realized_pnl: float | None = None
    reason: str
    executed_at: datetime


class NewsArticle(BaseModel):
    """Normalized, untrusted news metadata collected from an external RSS feed."""

    model_config = ConfigDict(extra="forbid")

    fingerprint: str = Field(min_length=64, max_length=64)
    title: str = Field(min_length=1, max_length=500)
    url: str = Field(min_length=1, max_length=2000)
    source: str = Field(min_length=1, max_length=200)
    published_at: datetime
    ticker: str | None = None
    query: str = Field(min_length=1, max_length=500)
    significance_score: int = Field(ge=0, le=10)
    sentiment: Literal["POSITIVE", "NEGATIVE", "NEUTRAL"]
