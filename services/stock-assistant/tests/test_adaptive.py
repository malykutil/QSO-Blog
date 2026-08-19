import pytest

from stock_assistant.adaptive import (
    FEATURE_NAMES,
    adaptive_score,
    default_weights,
    learn_from_outcome,
    snapshot_features,
)


def test_snapshot_features_and_score_are_bounded(snapshot):
    features = snapshot_features(snapshot)
    score = adaptive_score(100, features, default_weights("HYBRID"))

    assert set(features) == set(FEATURE_NAMES)
    assert all(0 <= value <= 1 for value in features.values())
    assert 0 <= score <= 100


def test_win_reinforces_policy_and_relaxes_threshold(snapshot):
    weights = default_weights("TREND")
    update = learn_from_outcome(
        features=snapshot_features(snapshot),
        weights=weights,
        threshold=75,
        base_threshold=75,
        realized_pnl=200,
        initial_risk=50,
        learning_rate=0.12,
    )

    assert update.reward_r == 4
    assert update.threshold < 75
    assert "Zisk" in update.lesson
    assert all(0.25 <= value <= 3 for value in update.weights.values())
    assert update.weights != weights


def test_loss_tightens_policy_and_rejects_invalid_feedback(snapshot):
    weights = default_weights("BREAKOUT")
    update = learn_from_outcome(
        features=snapshot_features(snapshot),
        weights=weights,
        threshold=75,
        base_threshold=75,
        realized_pnl=-50,
        initial_risk=50,
        learning_rate=0.12,
    )

    assert update.reward_r == -1
    assert update.threshold > 75
    assert "Ztráta" in update.lesson
    assert all(0.25 <= value <= 3 for value in update.weights.values())

    with pytest.raises(ValueError, match="zpětná vazba"):
        learn_from_outcome(
            features=snapshot_features(snapshot),
            weights=weights,
            threshold=75,
            base_threshold=75,
            realized_pnl=0,
            initial_risk=0,
            learning_rate=0.12,
        )
