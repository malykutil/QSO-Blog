import math

from stock_assistant.db import Repository
from stock_assistant.models import Action, IndicatorSnapshot, TradeAnalysis, TradeExecution
from stock_assistant.risk import calculate_position_size, validate_analysis


class PaperBroker:
    """The only execution engine. It only mutates the local SQLite paper ledger."""

    def __init__(
        self,
        repository: Repository,
        *,
        max_risk_fraction: float = 0.01,
        min_risk_reward: float = 2.5,
    ) -> None:
        self.repository = repository
        self.max_risk_fraction = min(max_risk_fraction, 0.01)
        self.min_risk_reward = max(min_risk_reward, 2.5)

    def equity(self, prices: dict[str, float]) -> float:
        positions = self.repository.get_positions()
        market_value = sum(
            position.quantity * prices.get(ticker, position.entry_price)
            for ticker, position in positions.items()
        )
        return self.repository.get_cash() + market_value

    def process(
        self,
        analysis: TradeAnalysis,
        snapshot: IndicatorSnapshot,
        prices: dict[str, float],
    ) -> tuple[TradeExecution | None, str]:
        positions = self.repository.get_positions()
        is_valid, reason = validate_analysis(
            analysis,
            snapshot,
            min_risk_reward=self.min_risk_reward,
            has_position=analysis.ticker in positions,
        )
        if not is_valid:
            return None, reason

        if analysis.action == Action.BUY:
            assert analysis.stop_loss is not None
            assert analysis.target_1 is not None
            assert analysis.target_2 is not None
            cash = self.repository.get_cash()
            quantity = calculate_position_size(
                equity=self.equity(prices),
                cash=cash,
                entry_price=snapshot.current_price,
                stop_loss=analysis.stop_loss,
                max_risk_fraction=self.max_risk_fraction,
            )
            if quantity < 1:
                return None, "risk/cash sizing produced zero whole shares"
            execution = self.repository.open_position(
                ticker=analysis.ticker,
                quantity=quantity,
                price=snapshot.current_price,
                stop_loss=analysis.stop_loss,
                target_1=analysis.target_1,
                target_2=analysis.target_2,
                reason=analysis.reason,
            )
            return execution, "paper BUY executed"

        if analysis.action == Action.SELL:
            execution = self.repository.close_position(
                analysis.ticker, snapshot.current_price, analysis.reason
            )
            return execution, "paper SELL executed"

        return None, f"{analysis.action.value} requires no paper execution"

    def protective_exit(
        self, ticker: str, current_price: float
    ) -> TradeExecution | None:
        position = self.repository.get_positions().get(ticker)
        if position is None:
            return None
        if current_price <= position.stop_loss:
            return self.repository.close_position(
                ticker, current_price, "dosažen ochranný stop-loss"
            )
        if current_price >= position.target_2:
            return self.repository.close_position(ticker, current_price, "dosažen druhý cenový cíl")
        return None

    def import_existing_position(
        self,
        *,
        ticker: str,
        quantity: int,
        entry_price: float,
        stop_loss: float,
        target_1: float,
        target_2: float,
    ) -> TradeExecution:
        levels = (entry_price, stop_loss, target_1, target_2)
        if quantity < 1 or not all(math.isfinite(value) and value > 0 for value in levels):
            raise ValueError("počet kusů a všechny cenové úrovně musí být kladné")
        if not stop_loss < entry_price < target_1 <= target_2:
            raise ValueError("úrovně musí splňovat stop < vstup < cíl1 <= cíl2")
        risk = quantity * (entry_price - stop_loss)
        risk_budget = self.equity({}) * self.max_risk_fraction
        if risk > risk_budget + 1e-9:
            raise ValueError(
                f"riziko pozice {risk:.2f} překračuje 1% limit {risk_budget:.2f}"
            )
        return self.repository.open_position(
            ticker=ticker.strip().upper(),
            quantity=quantity,
            price=entry_price,
            stop_loss=stop_loss,
            target_1=target_1,
            target_2=target_2,
            reason="Existující PAPER pozice ručně přidána do monitoringu",
        )
