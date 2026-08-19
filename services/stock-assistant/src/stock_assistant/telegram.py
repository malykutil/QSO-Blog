import hashlib
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from stock_assistant.db import Repository
from stock_assistant.models import Action, NewsArticle, Position, TradeExecution

logger = logging.getLogger(__name__)
PRAGUE_TIMEZONE = ZoneInfo("Europe/Prague")


class TelegramNotifier:
    def __init__(
        self,
        repository: Repository,
        bot_token: str | None,
        chat_id: str | None,
        *,
        change_threshold: float = 0.005,
        position_update_threshold: float = 0.005,
    ) -> None:
        self.repository = repository
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.change_threshold = change_threshold
        self.position_update_threshold = position_update_threshold

    def send_text(self, message: str) -> bool:
        if not self.bot_token or not self.chat_id:
            logger.info("Telegram disabled; text message not sent")
            return False
        response = httpx.post(
            f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
            json={"chat_id": self.chat_id, "text": message},
            timeout=10.0,
        )
        response.raise_for_status()
        return True

    def send_news(self, article: NewsArticle) -> bool:
        scope = article.ticker or "TRH"
        sentiment = {
            "POSITIVE": "POZITIVNÍ",
            "NEGATIVE": "NEGATIVNÍ",
            "NEUTRAL": "NEUTRÁLNÍ",
        }[article.sentiment]
        published = article.published_at.astimezone(PRAGUE_TIMEZONE).strftime(
            "%d.%m.%Y %H:%M %Z"
        )
        message = (
            f"DŮLEŽITÁ ZPRÁVA [{scope}]\n"
            f"Dopad: {sentiment} | skóre {article.significance_score}/10\n"
            f"{article.title}\n"
            f"Zdroj: {article.source}\n"
            f"Publikováno: {published}\n"
            f"{article.url}\n\n"
            "Pouze informativní zpráva. Na základě samotného titulku nebyl proveden žádný obchod."
        )
        return self.send_text(message)

    def _fingerprint(
        self,
        execution: TradeExecution,
        stop_loss: float | None,
        target_1: float | None,
    ) -> str:
        raw = (
            f"{execution.ticker}|{execution.side}|{execution.price:.2f}|"
            f"{stop_loss or 0:.2f}|{target_1 or 0:.2f}"
        )
        return hashlib.sha256(raw.encode()).hexdigest()

    def is_meaningful(
        self,
        execution: TradeExecution,
        stop_loss: float | None,
        target_1: float | None,
    ) -> bool:
        previous = self.repository.last_alert(execution.ticker)
        if previous is None or previous["action"] != execution.side:
            return True

        def changed(old: float | None, new: float | None) -> bool:
            if old is None and new is None:
                return False
            if old is None or new is None or old == 0:
                return True
            return abs(new - old) / abs(old) >= self.change_threshold

        return any(
            (
                changed(previous["price"], execution.price),
                changed(previous["stop_loss"], stop_loss),
                changed(previous["target_1"], target_1),
            )
        )

    def send_execution(
        self, execution: TradeExecution, position: Position | None = None
    ) -> bool:
        action = Action(execution.side)
        if action not in (Action.BUY, Action.SELL):
            return False
        stop_loss = position.stop_loss if position else None
        target_1 = position.target_1 if position else None
        if not self.is_meaningful(execution, stop_loss, target_1):
            logger.info("Telegram suppressed: no meaningful change for %s", execution.ticker)
            return False
        if not self.bot_token or not self.chat_id:
            logger.info("Telegram disabled; execution remains stored in SQLite")
            return False

        pnl = (
            f"\nRealizovaný výsledek: {execution.realized_pnl:+,.2f} USD"
            if execution.realized_pnl is not None
            else ""
        )
        levels = (
            f"\nStop-loss: {stop_loss:.2f}\nCíl 1: {target_1:.2f}"
            if stop_loss is not None and target_1 is not None
            else ""
        )
        action_label = "NÁKUP" if execution.side == "BUY" else "PRODEJ"
        message = (
            f"PAPER {action_label} ({execution.side}) {execution.ticker}\n"
            f"Počet: {execution.quantity}\nCena: {execution.price:.2f} USD"
            f"{levels}{pnl}\nDůvod: {execution.reason}"
        )
        response = httpx.post(
            f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
            json={"chat_id": self.chat_id, "text": message},
            timeout=10.0,
        )
        response.raise_for_status()
        fingerprint = self._fingerprint(execution, stop_loss, target_1)
        self.repository.record_alert(
            execution.ticker, action, execution.price, stop_loss, target_1, fingerprint
        )
        return True

    def send_position_update(
        self,
        position: Position,
        current_price: float,
        source_timestamp: datetime,
    ) -> bool:
        """Send the first snapshot and later updates only after a meaningful price move."""
        previous = self.repository.last_position_update(position.ticker)
        if previous is not None:
            previous_price = float(previous["price"])
            price_change = abs(current_price - previous_price) / previous_price
            if price_change < self.position_update_threshold:
                logger.debug(
                    "Position update suppressed for %s: price change %.3f%%",
                    position.ticker,
                    price_change * 100,
                )
                return False
        if not self.bot_token or not self.chat_id:
            logger.info("Telegram disabled; position update not sent")
            return False

        unrealized_pnl = (current_price - position.entry_price) * position.quantity
        pnl_percent = (current_price / position.entry_price - 1) * 100
        stop_distance = (current_price / position.stop_loss - 1) * 100
        target_1_distance = (position.target_1 / current_price - 1) * 100
        target_2_distance = (position.target_2 / current_price - 1) * 100
        data_time = source_timestamp.astimezone(PRAGUE_TIMEZONE).strftime(
            "%d.%m.%Y %H:%M %Z"
        )
        message = (
            f"VÝVOJ PAPER POZICE {position.ticker}\n"
            f"Aktuální cena: {current_price:.2f} USD\n"
            f"Pozice: {position.quantity} ks @ {position.entry_price:.2f}\n"
            f"Nerealizovaný výsledek: {unrealized_pnl:+,.2f} USD ({pnl_percent:+.2f} %)\n"
            f"Stop-loss: {position.stop_loss:.2f} (cena {stop_distance:+.2f} % vůči stopu)\n"
            f"Cíl 1: {position.target_1:.2f} (vzdálenost {target_1_distance:+.2f} %)\n"
            f"Cíl 2: {position.target_2:.2f} (vzdálenost {target_2_distance:+.2f} %)\n"
            f"Čas tržních dat: {data_time}"
        )
        response = httpx.post(
            f"https://api.telegram.org/bot{self.bot_token}/sendMessage",
            json={"chat_id": self.chat_id, "text": message},
            timeout=10.0,
        )
        response.raise_for_status()
        self.repository.record_position_update(
            ticker=position.ticker,
            price=current_price,
            unrealized_pnl=unrealized_pnl,
            pnl_percent=pnl_percent,
            source_timestamp=source_timestamp,
        )
        return True
