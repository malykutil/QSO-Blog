import sys

import httpx

from stock_assistant.config import Settings


def main() -> int:
    settings = Settings()
    if not settings.telegram_bot_token:
        print("Telegram není nakonfigurovaný.")
        return 1

    base_url = "https://api.telegram.org/bot" + settings.telegram_bot_token
    commands = [
        {"command": "add", "description": "Přidat existující PAPER pozici"},
        {"command": "positions", "description": "Zobrazit sledované PAPER pozice"},
        {"command": "status", "description": "Zobrazit stav PAPER účtu a služby"},
        {"command": "news", "description": "Zobrazit posledních pět zpráv"},
        {"command": "help", "description": "Zobrazit českou nápovědu"},
    ]
    operations = [
        ("setMyCommands", {"commands": commands}),
        (
            "setMyDescription",
            {
                "description": (
                    "Český AI asistent pro bezpečný PAPER trading. Sleduje americké akcie, "
                    "otevřené pozice a důležité tržní zprávy. Nikdy neobchoduje se skutečnými "
                    "penězi."
                )
            },
        ),
        (
            "setMyShortDescription",
            {
                "short_description": (
                    "Český AI asistent pro PAPER trading a tržní zprávy."
                )
            },
        ),
    ]
    try:
        with httpx.Client(timeout=10.0) as client:
            for method, payload in operations:
                response = client.post(f"{base_url}/{method}", json=payload)
                if response.status_code != 200 or not response.json().get("ok"):
                    print(f"Nastavení Telegramu selhalo v kroku {method}.")
                    return 1
    except Exception as exc:
        # HTTP exception text can contain the bot token, so report the type only.
        print(f"Nastavení Telegramu selhalo: {type(exc).__name__}")
        return 1
    print("Český profil a nabídka příkazů Telegram bota byly aktualizovány.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
