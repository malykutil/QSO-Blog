import math

from stock_assistant.models import Action, IndicatorSnapshot, TradeAnalysis


def _valid_level(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and value > 0


def validate_analysis(
    analysis: TradeAnalysis,
    snapshot: IndicatorSnapshot,
    *,
    min_risk_reward: float,
    has_position: bool,
) -> tuple[bool, str]:
    if analysis.ticker != snapshot.ticker:
        return False, "LLM ticker does not match the screened ticker"

    if analysis.action == Action.BUY:
        if has_position:
            return False, "position already exists; pyramiding is disabled"
        levels = (
            analysis.entry_low,
            analysis.entry_high,
            analysis.stop_loss,
            analysis.target_1,
            analysis.target_2,
        )
        if not all(_valid_level(level) for level in levels):
            return False, "BUY requires finite positive entry, stop and both targets"
        assert analysis.entry_low is not None
        assert analysis.entry_high is not None
        assert analysis.stop_loss is not None
        assert analysis.target_1 is not None
        assert analysis.target_2 is not None
        if analysis.entry_low > analysis.entry_high:
            return False, "entry_low is above entry_high"
        if not analysis.entry_low <= snapshot.current_price <= analysis.entry_high:
            return False, "authoritative current price is outside the proposed entry band"
        if analysis.stop_loss >= snapshot.current_price:
            return False, "stop-loss must be below the actual paper fill price"
        if analysis.target_1 <= snapshot.current_price or analysis.target_2 < analysis.target_1:
            return False, "targets are not ordered above the actual paper fill price"
        actual_rr = (analysis.target_1 - snapshot.current_price) / (
            snapshot.current_price - analysis.stop_loss
        )
        if not math.isfinite(actual_rr) or actual_rr < min_risk_reward:
            return False, (
                f"server-calculated risk/reward {actual_rr:.2f} "
                f"is below {min_risk_reward:.2f}"
            )
        analysis.risk_reward = round(actual_rr, 3)
        return True, "valid BUY"

    if analysis.action == Action.SELL and not has_position:
        return False, "SELL ignored because no paper position exists"

    return True, f"valid {analysis.action.value}"


def calculate_position_size(
    *,
    equity: float,
    cash: float,
    entry_price: float,
    stop_loss: float,
    max_risk_fraction: float,
) -> int:
    monetary_values = (equity, cash, entry_price, stop_loss)
    if not all(math.isfinite(value) and value > 0 for value in monetary_values):
        return 0
    per_share_risk = entry_price - stop_loss
    if per_share_risk <= 0:
        return 0
    risk_budget = equity * min(max_risk_fraction, 0.01)
    by_risk = math.floor(risk_budget / per_share_risk)
    by_cash = math.floor(cash / entry_price)
    return max(0, min(by_risk, by_cash))
