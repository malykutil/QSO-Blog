import json
import logging
import re

import httpx

from stock_assistant.db import Repository
from stock_assistant.paper import PaperBroker
from stock_assistant.telegram import TelegramNotifier

logger = logging.getLogger(__name__)

OFFSET_STATE_KEY = "telegram_update_offset"
TICKER_PATTERN = re.compile(r"^[A-Z][A-Z0-9.-]{0,14}$")

HELP_TEXT = """AI akciový PAPER asistent

/add TICKER QTY ENTRY STOP TARGET1 TARGET2
Přidá existující PAPER pozici do monitoringu.
Příklad: /add AAPL 10 220 215 233 240

/positions
Vypíše sledované pozice a jejich rizikové úrovně.

/status
Zobrazí stav PAPER účtu a plánovače.

/news
Zobrazí pět naposledy načtených tržních zpráv.

/help
Zobrazí tuto nápovědu.

Bot nikdy neodesílá příkazy skutečnému brokerovi."""


class TelegramCommandService:
    """Authenticated command polling for the single configured Telegram chat."""

    def __init__(
        self,
        *,
        repository: Repository,
        broker: PaperBroker,
        notifier: TelegramNotifier,
        bot_token: str,
        allowed_chat_id: str,
    ) -> None:
        self.repository = repository
        self.broker = broker
        self.notifier = notifier
        self.bot_token = bot_token
        self.allowed_chat_id = str(allowed_chat_id)

    def poll_once(self) -> None:
        try:
            offset_value = self.repository.get_state(OFFSET_STATE_KEY)
            params: dict[str, str | int] = {
                "timeout": 0,
                "allowed_updates": json.dumps(["message"]),
            }
            if offset_value is not None:
                params["offset"] = int(offset_value)
            response = httpx.get(
                f"https://api.telegram.org/bot{self.bot_token}/getUpdates",
                params=params,
                timeout=10.0,
            )
            response.raise_for_status()
            payload = response.json()
            if not payload.get("ok"):
                raise RuntimeError("Telegram getUpdates returned ok=false")
            for update in payload.get("result", []):
                update_id = int(update["update_id"])
                try:
                    self._handle_update(update)
                except Exception as exc:
                    logger.exception("Telegram command failed for update %d", update_id)
                    self.notifier.send_text(f"Příkaz nelze provést: {exc}")
                finally:
                    self.repository.set_state(OFFSET_STATE_KEY, str(update_id + 1))
        except Exception as exc:
            # HTTP exceptions may embed the bot token in the request URL.
            logger.error(
                "Telegram command polling failed safely error_type=%s",
                type(exc).__name__,
            )

    def _handle_update(self, update: dict) -> None:
        message = update.get("message") or {}
        chat = message.get("chat") or {}
        chat_id = str(chat.get("id", ""))
        if chat_id != self.allowed_chat_id:
            logger.warning("Ignored Telegram command from unauthorized chat")
            return
        text = str(message.get("text", "")).strip()
        if not text.startswith("/"):
            self.notifier.send_text(HELP_TEXT)
            return

        parts = text.split()
        command = parts[0].split("@", maxsplit=1)[0].lower()
        if command in {"/start", "/help"}:
            self.notifier.send_text(HELP_TEXT)
            return
        if command == "/positions":
            self.notifier.send_text(self._positions_text())
            return
        if command == "/status":
            positions = self.repository.get_positions()
            self.notifier.send_text(
                "STAV PAPER ÚČTU\n"
                f"Hotovost: {self.repository.get_cash():,.2f} USD\n"
                f"Otevřené pozice: {len(positions)}\n"
                "Plánovač: aktivní"
            )
            return
        if command == "/news":
            self.notifier.send_text(self._news_text())
            return
        if command == "/add":
            self._add_position(parts)
            return
        self.notifier.send_text("Neznámý příkaz.\n\n" + HELP_TEXT)

    def _add_position(self, parts: list[str]) -> None:
        if len(parts) != 7:
            raise ValueError("použijte /add TICKER QTY ENTRY STOP TARGET1 TARGET2")
        ticker = parts[1].upper().replace(".", "-")
        if not TICKER_PATTERN.fullmatch(ticker):
            raise ValueError("ticker má neplatný formát")
        try:
            quantity = int(parts[2])
            entry, stop, target_1, target_2 = (
                float(value.replace(",", ".")) for value in parts[3:]
            )
        except ValueError as exc:
            raise ValueError("počet musí být celé číslo a ceny musí být číselné") from exc
        execution = self.broker.import_existing_position(
            ticker=ticker,
            quantity=quantity,
            entry_price=entry,
            stop_loss=stop,
            target_1=target_1,
            target_2=target_2,
        )
        self.notifier.send_text(
            f"PAPER POZICE PŘIDÁNA: {execution.ticker}\n"
            f"Počet: {quantity}\nVstup: {entry:.2f}\nStop-loss: {stop:.2f}\n"
            f"Cíl 1: {target_1:.2f}\nCíl 2: {target_2:.2f}\n"
            "První zpráva o vývoji přijde s prvním platným tržním snapshotem."
        )

    def _positions_text(self) -> str:
        positions = self.repository.get_positions()
        if not positions:
            return "PAPER POZICE\nŽádné otevřené pozice."
        lines = ["PAPER POZICE"]
        for position in positions.values():
            lines.append(
                f"{position.ticker}: {position.quantity} @ {position.entry_price:.2f} | "
                f"SL {position.stop_loss:.2f} | T1 {position.target_1:.2f} | "
                f"T2 {position.target_2:.2f}"
            )
        return "\n".join(lines)

    def _news_text(self) -> str:
        articles = self.repository.recent_news(limit=5)
        if not articles:
            return "ZPRÁVY\nZatím nebyly načteny žádné zprávy."
        lines = ["POSLEDNÍ NAČTENÉ ZPRÁVY"]
        for article in articles:
            scope = article.ticker or "TRH"
            lines.append(
                f"[{scope}] {article.title}\n{article.source} | "
                f"skóre {article.significance_score}/10\n{article.url}"
            )
        return "\n\n".join(lines)
