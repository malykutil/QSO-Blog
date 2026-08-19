import logging
import math

from stock_assistant.adaptive import (
    adaptive_score,
    learn_from_outcome,
    snapshot_features,
)
from stock_assistant.config import Settings
from stock_assistant.db import Repository
from stock_assistant.models import IndicatorSnapshot

logger = logging.getLogger(__name__)


def score_snapshot(snapshot: IndicatorSnapshot) -> float:
    """Deterministic 0-100 score shared by the isolated PAPER agents."""
    trend_checks = (
        snapshot.current_price > snapshot.ema20,
        snapshot.ema20 > snapshot.ema50,
        snapshot.ema50 > snapshot.ema200,
        snapshot.trend_strength > 0,
        -2 <= snapshot.distance_ema20 <= 8,
    )
    trend = sum(trend_checks) * 6
    momentum = 0
    momentum += 8 if snapshot.momentum_20 > 0 else 0
    momentum += 6 if snapshot.macd_histogram > 0 else 0
    momentum += 6 if 50 <= snapshot.rsi <= 72 else 0
    volume = min(snapshot.relative_volume / 1.5, 1.0) * 15
    structure = 0
    structure += 10 if snapshot.current_price >= snapshot.recent_high_20 else 0
    structure += 5 if snapshot.current_price >= snapshot.recent_low_20 * 1.03 else 0
    atr_percent = snapshot.atr / snapshot.current_price * 100
    volatility = 10 if 0.5 <= atr_percent <= 5 else 0
    quality = 5 if abs(snapshot.gap_percent) <= 3 else 0
    quality += 5 if snapshot.close >= snapshot.open else 0
    return min(100.0, trend + momentum + volume + structure + volatility + quality)


def strategy_accepts(strategy: str, snapshot: IndicatorSnapshot, score: float) -> bool:
    bullish_stack = (
        snapshot.current_price > snapshot.ema20 > snapshot.ema50 > snapshot.ema200
    )
    breakout = (
        snapshot.current_price >= snapshot.recent_high_20
        and snapshot.relative_volume >= 1.5
        and snapshot.macd_histogram > 0
    )
    momentum = (
        snapshot.momentum_20 >= 2
        and snapshot.relative_volume >= 1.3
        and 55 <= snapshot.rsi <= 75
        and snapshot.macd_histogram > 0
    )
    if strategy == "TREND":
        return bullish_stack and 50 <= snapshot.rsi <= 70 and snapshot.momentum_20 > 0
    if strategy == "BREAKOUT":
        return breakout
    if strategy == "MOMENTUM":
        return momentum
    if strategy == "HYBRID":
        return score >= 80 and bullish_stack and (breakout or momentum)
    return False


class AgentLeague:
    """Eight region-isolated adaptive PAPER portfolios sharing validated quotes."""

    def __init__(self, repository: Repository, settings: Settings) -> None:
        self.repository = repository
        self.settings = settings

    def process(
        self,
        snapshots: dict[str, IndicatorSnapshot],
        *,
        market: str = "US",
    ) -> None:
        if not snapshots:
            return
        self.repository.save_market_quotes(snapshots)
        for account in self.repository.get_agent_accounts(market):
            if not account["enabled"]:
                continue
            agent_id = int(account["id"])
            try:
                self._process_agent(agent_id, str(account["strategy"]), snapshots)
                self.repository.record_agent_equity(agent_id)
            except Exception as exc:
                logger.error(
                    "Agent league cycle failed safely agent=%s error_type=%s",
                    account["slug"],
                    type(exc).__name__,
                )

    def _process_agent(
        self,
        agent_id: int,
        strategy: str,
        snapshots: dict[str, IndicatorSnapshot],
    ) -> None:
        state = self.repository.agent_runtime_state(agent_id)
        closed_tickers: set[str] = set()
        for position in list(state["positions"]):
            ticker = str(position["ticker"])
            snapshot = snapshots.get(ticker)
            if snapshot is None:
                continue
            if snapshot.current_price <= float(position["stop_loss"]):
                self._close_and_learn(
                    agent_id,
                    ticker,
                    position,
                    snapshot.current_price,
                    "Dosažen ochranný stop-loss.",
                )
                closed_tickers.add(ticker)
            elif snapshot.current_price >= float(position["target_2"]):
                self._close_and_learn(
                    agent_id,
                    ticker,
                    position,
                    snapshot.current_price,
                    "Dosažen druhý cenový cíl.",
                )
                closed_tickers.add(ticker)

        state = self.repository.agent_runtime_state(agent_id)
        positions = {str(position["ticker"]) for position in state["positions"]}
        if len(positions) >= self.settings.agent_max_positions:
            return

        learning = self.repository.get_agent_learning_state(agent_id)
        weights = dict(learning["weights"])
        threshold = float(learning["decision_threshold"])
        policy_version = int(learning["policy_version"])
        ranked: list[tuple[float, float, dict[str, float], IndicatorSnapshot]] = []
        for snapshot in snapshots.values():
            if snapshot.ticker in positions or snapshot.ticker in closed_tickers:
                continue
            base_score = score_snapshot(snapshot)
            features = snapshot_features(snapshot)
            decision_score = adaptive_score(base_score, features, weights)
            ranked.append((decision_score, base_score, features, snapshot))
        ranked.sort(key=lambda item: item[0], reverse=True)

        for decision_score, base_score, features, snapshot in ranked:
            if decision_score < threshold:
                break
            if not strategy_accepts(strategy, snapshot, base_score):
                continue
            if self._try_open(
                agent_id,
                strategy,
                snapshot,
                base_score,
                decision_score,
                features,
                policy_version,
            ):
                break  # At most one new position per agent and cycle.

    def _close_and_learn(
        self,
        agent_id: int,
        ticker: str,
        position: dict[str, object],
        price: float,
        reason: str,
    ) -> None:
        learning_update: dict[str, object] | None = None
        try:
            context = self.repository.get_agent_trade_context(agent_id, ticker)
            learning = self.repository.get_agent_learning_state(agent_id)
            if context is not None:
                quantity = int(position["quantity"])
                realized_pnl = (price - float(position["entry_price"])) * quantity
                update = learn_from_outcome(
                    features=dict(context["features"]),
                    weights=dict(learning["weights"]),
                    threshold=float(learning["decision_threshold"]),
                    base_threshold=float(learning["base_threshold"]),
                    realized_pnl=realized_pnl,
                    initial_risk=float(context["initial_risk"]),
                    learning_rate=self.settings.agent_learning_rate,
                )
                learning_update = {
                    "weights": update.weights,
                    "threshold": update.threshold,
                    "reward_r": update.reward_r,
                    "lesson": update.lesson,
                }
        except Exception as exc:
            # A learning failure must never delay a protective PAPER exit.
            logger.error(
                "Agent learning failed; closing safely agent_id=%d ticker=%s error_type=%s",
                agent_id,
                ticker,
                type(exc).__name__,
            )

        realized_pnl = self.repository.agent_close_position(
            agent_id=agent_id,
            ticker=ticker,
            price=price,
            reason=reason,
            learning_update=learning_update,
        )
        logger.info(
            "Agent PAPER SELL agent_id=%d ticker=%s pnl=%.2f learned=%s",
            agent_id,
            ticker,
            realized_pnl,
            learning_update is not None,
        )

    def _try_open(
        self,
        agent_id: int,
        strategy: str,
        snapshot: IndicatorSnapshot,
        base_score: float,
        decision_score: float,
        features: dict[str, float],
        policy_version: int,
    ) -> bool:
        state = self.repository.agent_runtime_state(agent_id)
        equity = float(state["equity"])
        cash = float(state["cash"])
        entry = snapshot.current_price
        stop = entry - 1.5 * snapshot.atr
        if not (math.isfinite(stop) and 0 < stop < entry):
            return False
        risk_per_share = entry - stop
        remaining_portfolio_risk = max(
            equity * self.settings.agent_max_portfolio_risk
            - float(state["portfolio_risk"]),
            0,
        )
        risk_budget = min(
            equity * self.settings.agent_risk_per_trade,
            remaining_portfolio_risk,
        )
        exposure_budget = equity * self.settings.agent_max_symbol_exposure
        quantity = min(
            math.floor(risk_budget / risk_per_share),
            math.floor(exposure_budget / entry),
            math.floor(cash / entry),
        )
        if quantity < 1:
            return False
        target_1 = entry + self.settings.min_risk_reward * risk_per_share
        target_2 = entry + 4 * risk_per_share
        initial_risk = quantity * risk_per_share
        self.repository.agent_open_position(
            agent_id=agent_id,
            ticker=snapshot.ticker,
            quantity=quantity,
            price=entry,
            stop_loss=stop,
            target_1=target_1,
            target_2=target_2,
            scanner_score=decision_score,
            reason=(
                f"Strategie {strategy}: adaptivní skóre {decision_score:.1f}/100 "
                f"(technické {base_score:.1f}), politika v{policy_version}."
            ),
            features=features,
            base_score=base_score,
            decision_score=decision_score,
            initial_risk=initial_risk,
            policy_version=policy_version,
        )
        logger.info(
            "Agent PAPER BUY agent_id=%d strategy=%s ticker=%s "
            "base_score=%.1f decision_score=%.1f policy=%d quantity=%d",
            agent_id,
            strategy,
            snapshot.ticker,
            base_score,
            decision_score,
            policy_version,
            quantity,
        )
        return True
