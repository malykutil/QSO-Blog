import math
from dataclasses import dataclass

from stock_assistant.models import IndicatorSnapshot

FEATURE_NAMES = ("trend", "momentum", "volume", "breakout", "quality")

_PRIOR_WEIGHTS: dict[str, dict[str, float]] = {
    "TREND": {
        "trend": 2.2,
        "momentum": 1.3,
        "volume": 0.8,
        "breakout": 0.5,
        "quality": 1.0,
    },
    "BREAKOUT": {
        "trend": 0.8,
        "momentum": 1.2,
        "volume": 2.0,
        "breakout": 2.2,
        "quality": 0.8,
    },
    "MOMENTUM": {
        "trend": 1.0,
        "momentum": 2.3,
        "volume": 1.5,
        "breakout": 0.7,
        "quality": 1.0,
    },
    "HYBRID": {
        "trend": 1.4,
        "momentum": 1.5,
        "volume": 1.3,
        "breakout": 1.2,
        "quality": 1.3,
    },
}

_FEATURE_LABELS = {
    "trend": "trend",
    "momentum": "momentum",
    "volume": "relativní objem",
    "breakout": "průraz ceny",
    "quality": "kvalitu trhu",
}


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def default_weights(strategy: str) -> dict[str, float]:
    try:
        return dict(_PRIOR_WEIGHTS[strategy])
    except KeyError as exc:
        raise ValueError(f"neznámá agentní strategie {strategy}") from exc


def snapshot_features(snapshot: IndicatorSnapshot) -> dict[str, float]:
    """Create bounded, explainable features without inventing market data."""
    trend_checks = (
        snapshot.current_price > snapshot.ema20,
        snapshot.ema20 > snapshot.ema50,
        snapshot.ema50 > snapshot.ema200,
        snapshot.trend_strength > 0,
        -2 <= snapshot.distance_ema20 <= 8,
    )
    trend = sum(trend_checks) / len(trend_checks)

    momentum_direction = _clamp(0.5 + snapshot.momentum_20 / 10, 0, 1)
    macd_direction = _clamp(
        0.5 + snapshot.macd_histogram / max(snapshot.atr, 1e-9),
        0,
        1,
    )
    rsi_quality = _clamp(1 - abs(snapshot.rsi - 62.5) / 25, 0, 1)
    momentum = (momentum_direction + macd_direction + rsi_quality) / 3

    volume = _clamp((snapshot.relative_volume - 0.5) / 2, 0, 1)
    breakout = _clamp(
        0.5
        + (snapshot.current_price - snapshot.recent_high_20)
        / max(snapshot.atr, 1e-9),
        0,
        1,
    )

    atr_percent = snapshot.atr / snapshot.current_price * 100
    volatility_quality = _clamp(1 - abs(atr_percent - 2.25) / 3.5, 0, 1)
    gap_quality = _clamp(1 - abs(snapshot.gap_percent) / 5, 0, 1)
    candle_quality = 1.0 if snapshot.close >= snapshot.open else 0.0
    quality = (volatility_quality + gap_quality + candle_quality) / 3

    return {
        "trend": trend,
        "momentum": momentum,
        "volume": volume,
        "breakout": breakout,
        "quality": quality,
    }


def adaptive_score(
    base_score: float,
    features: dict[str, float],
    weights: dict[str, float],
) -> float:
    total_weight = sum(max(float(weights.get(name, 0)), 0) for name in FEATURE_NAMES)
    if not math.isfinite(total_weight) or total_weight <= 0:
        return _clamp(base_score, 0, 100)
    learned_quality = (
        sum(
            max(float(weights.get(name, 0)), 0)
            * _clamp(float(features.get(name, 0)), 0, 1)
            for name in FEATURE_NAMES
        )
        / total_weight
        * 100
    )
    return _clamp(base_score * 0.65 + learned_quality * 0.35, 0, 100)


@dataclass(frozen=True)
class LearningUpdate:
    weights: dict[str, float]
    threshold: float
    reward_r: float
    lesson: str


def learn_from_outcome(
    *,
    features: dict[str, float],
    weights: dict[str, float],
    threshold: float,
    base_threshold: float,
    realized_pnl: float,
    initial_risk: float,
    learning_rate: float,
) -> LearningUpdate:
    if not (
        math.isfinite(realized_pnl)
        and math.isfinite(initial_risk)
        and initial_risk > 0
    ):
        raise ValueError("neplatná zpětná vazba PAPER obchodu")

    reward_r = realized_pnl / initial_risk
    normalized_reward = _clamp(reward_r, -1, 1)
    updated_weights: dict[str, float] = {}
    for name in FEATURE_NAMES:
        previous = _clamp(float(weights.get(name, 1)), 0.25, 3)
        centered_feature = 2 * _clamp(float(features.get(name, 0.5)), 0, 1) - 1
        factor = math.exp(learning_rate * normalized_reward * centered_feature)
        updated_weights[name] = round(_clamp(previous * factor, 0.25, 3), 6)

    updated_threshold = _clamp(
        threshold - normalized_reward * 1.5,
        base_threshold - 8,
        base_threshold + 12,
    )
    dominant_feature = max(
        FEATURE_NAMES,
        key=lambda name: float(weights.get(name, 0))
        * float(features.get(name, 0)),
    )
    label = _FEATURE_LABELS[dominant_feature]
    if reward_r > 0:
        lesson = f"Zisk {reward_r:+.2f} R: model potvrdil a posílil vliv „{label}“."
    elif reward_r < 0:
        lesson = (
            f"Ztráta {reward_r:+.2f} R: model zpřísnil vstup "
            f"a oslabil vliv „{label}“."
        )
    else:
        lesson = "Výsledek 0.00 R: model zachoval současné váhy."

    return LearningUpdate(
        weights=updated_weights,
        threshold=round(updated_threshold, 6),
        reward_r=round(reward_r, 6),
        lesson=lesson,
    )
