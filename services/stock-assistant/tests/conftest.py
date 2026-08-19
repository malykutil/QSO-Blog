from datetime import UTC, datetime

import pandas as pd
import pytest

from stock_assistant.models import IndicatorSnapshot


@pytest.fixture
def now() -> datetime:
    return datetime(2026, 8, 19, 15, 0, tzinfo=UTC)


@pytest.fixture
def snapshot(now: datetime) -> IndicatorSnapshot:
    return IndicatorSnapshot(
        ticker="TEST",
        timestamp=now,
        current_price=100.0,
        open=99.5,
        high=101.0,
        low=99.0,
        close=100.0,
        volume=2_000,
        ema20=98.0,
        ema50=95.0,
        ema200=90.0,
        rsi=60.0,
        macd=1.2,
        macd_signal=0.8,
        macd_histogram=0.4,
        atr=2.0,
        relative_volume=1.8,
        average_volume_20=1_000,
        recent_high_20=99.8,
        recent_low_20=90.0,
        momentum_20=4.0,
        gap_percent=0.3,
        distance_ema20=2.04,
        trend_strength=8.89,
        bars=260,
    )


@pytest.fixture
def ohlcv(now: datetime) -> pd.DataFrame:
    index = pd.date_range(end=now, periods=260, freq="5min", tz="UTC")
    close = pd.Series([100 + i * 0.05 for i in range(260)], index=index)
    volume = pd.Series([1_000.0] * 259 + [2_000.0], index=index)
    return pd.DataFrame(
        {
            "Open": close - 0.1,
            "High": close + 0.5,
            "Low": close - 0.5,
            "Close": close,
            "Volume": volume,
        },
        index=index,
    )
