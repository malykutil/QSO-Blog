import math

import pandas as pd

from stock_assistant.models import IndicatorSnapshot

REQUIRED_COLUMNS = ("Open", "High", "Low", "Close", "Volume")
MINIMUM_BARS = 200


class InvalidMarketData(ValueError):
    """Raised when data is missing or unsafe to use for a trading decision."""


def add_indicators(frame: pd.DataFrame) -> pd.DataFrame:
    missing = set(REQUIRED_COLUMNS) - set(frame.columns)
    if missing:
        raise InvalidMarketData(f"missing OHLCV columns: {sorted(missing)}")

    result = frame.loc[:, list(REQUIRED_COLUMNS)].copy()
    for column in REQUIRED_COLUMNS:
        result[column] = pd.to_numeric(result[column], errors="coerce")
    result = result.replace([math.inf, -math.inf], pd.NA).dropna()
    result = result[(result[["Open", "High", "Low", "Close"]] > 0).all(axis=1)]
    result = result[result["Volume"] > 0]
    if len(result) < MINIMUM_BARS:
        raise InvalidMarketData(f"only {len(result)} valid bars; need at least {MINIMUM_BARS}")

    close = result["Close"]
    result["EMA20"] = close.ewm(span=20, adjust=False, min_periods=20).mean()
    result["EMA50"] = close.ewm(span=50, adjust=False, min_periods=50).mean()
    result["EMA200"] = close.ewm(span=200, adjust=False, min_periods=200).mean()

    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    average_gain = gain.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    average_loss = loss.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    relative_strength = average_gain / average_loss.replace(0, 1e-12)
    result["RSI"] = 100 - (100 / (1 + relative_strength))

    ema12 = close.ewm(span=12, adjust=False, min_periods=12).mean()
    ema26 = close.ewm(span=26, adjust=False, min_periods=26).mean()
    result["MACD"] = ema12 - ema26
    result["MACD_SIGNAL"] = result["MACD"].ewm(span=9, adjust=False, min_periods=9).mean()
    result["MACD_HISTOGRAM"] = result["MACD"] - result["MACD_SIGNAL"]

    previous_close = close.shift(1)
    true_range = pd.concat(
        [
            result["High"] - result["Low"],
            (result["High"] - previous_close).abs(),
            (result["Low"] - previous_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    result["ATR"] = true_range.ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    prior_average_volume = result["Volume"].shift(1).rolling(20, min_periods=20).mean()
    result["AVERAGE_VOLUME_20"] = prior_average_volume
    result["RELATIVE_VOLUME"] = result["Volume"] / prior_average_volume
    result["RECENT_HIGH_20"] = result["High"].shift(1).rolling(20, min_periods=20).max()
    result["RECENT_LOW_20"] = result["Low"].shift(1).rolling(20, min_periods=20).min()
    result["MOMENTUM_20"] = close.pct_change(20) * 100
    result["GAP_PERCENT"] = (result["Open"] / previous_close - 1) * 100
    result["DISTANCE_EMA20"] = (close / result["EMA20"] - 1) * 100
    result["TREND_STRENGTH"] = (result["EMA20"] / result["EMA200"] - 1) * 100
    return result


def build_snapshot(ticker: str, frame: pd.DataFrame) -> IndicatorSnapshot:
    enriched = add_indicators(frame)
    row = enriched.iloc[-1]
    required = [
        *REQUIRED_COLUMNS,
        "EMA20",
        "EMA50",
        "EMA200",
        "RSI",
        "MACD",
        "MACD_SIGNAL",
        "MACD_HISTOGRAM",
        "ATR",
        "RELATIVE_VOLUME",
        "AVERAGE_VOLUME_20",
        "RECENT_HIGH_20",
        "RECENT_LOW_20",
        "MOMENTUM_20",
        "GAP_PERCENT",
        "DISTANCE_EMA20",
        "TREND_STRENGTH",
    ]
    if any(not math.isfinite(float(row[name])) for name in required):
        raise InvalidMarketData("latest bar contains a non-finite value")

    timestamp = pd.Timestamp(enriched.index[-1])
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("UTC")
    else:
        timestamp = timestamp.tz_convert("UTC")

    return IndicatorSnapshot(
        ticker=ticker.upper(),
        timestamp=timestamp.to_pydatetime(),
        current_price=float(row["Close"]),
        open=float(row["Open"]),
        high=float(row["High"]),
        low=float(row["Low"]),
        close=float(row["Close"]),
        volume=float(row["Volume"]),
        ema20=float(row["EMA20"]),
        ema50=float(row["EMA50"]),
        ema200=float(row["EMA200"]),
        rsi=float(row["RSI"]),
        macd=float(row["MACD"]),
        macd_signal=float(row["MACD_SIGNAL"]),
        macd_histogram=float(row["MACD_HISTOGRAM"]),
        atr=float(row["ATR"]),
        relative_volume=float(row["RELATIVE_VOLUME"]),
        average_volume_20=float(row["AVERAGE_VOLUME_20"]),
        recent_high_20=float(row["RECENT_HIGH_20"]),
        recent_low_20=float(row["RECENT_LOW_20"]),
        momentum_20=float(row["MOMENTUM_20"]),
        gap_percent=float(row["GAP_PERCENT"]),
        distance_ema20=float(row["DISTANCE_EMA20"]),
        trend_strength=float(row["TREND_STRENGTH"]),
        bars=len(enriched),
    )
