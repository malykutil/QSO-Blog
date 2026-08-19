import pytest

from stock_assistant.indicators import InvalidMarketData, add_indicators, build_snapshot


def test_all_required_indicators_are_calculated(ohlcv):
    enriched = add_indicators(ohlcv)
    expected = {
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
    }
    assert expected.issubset(enriched.columns)
    assert enriched.iloc[-1]["RELATIVE_VOLUME"] == pytest.approx(2.0)

    snapshot = build_snapshot("test", ohlcv)
    assert snapshot.ticker == "TEST"
    assert snapshot.current_price == pytest.approx(ohlcv.iloc[-1]["Close"])
    assert snapshot.bars == 260


def test_missing_or_short_data_is_rejected(ohlcv):
    with pytest.raises(InvalidMarketData, match="missing OHLCV"):
        add_indicators(ohlcv.drop(columns=["Volume"]))
    with pytest.raises(InvalidMarketData, match="need at least"):
        add_indicators(ohlcv.iloc[:100])


def test_nonpositive_latest_volume_is_not_used(ohlcv):
    broken = ohlcv.copy()
    broken.loc[broken.index[-61] :, "Volume"] = 0
    with pytest.raises(InvalidMarketData, match="only 199 valid bars"):
        build_snapshot("TEST", broken)
