import json
import logging
from datetime import UTC, datetime, timedelta
from io import StringIO
from pathlib import Path

import pandas as pd
import requests
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)

SP500_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
NASDAQ100_URL = "https://www.nasdaq.com/solutions/global-indexes/nasdaq-100/companies"


class UniverseUnavailable(RuntimeError):
    pass


def _normalize_symbol(symbol: object) -> str:
    return str(symbol).strip().upper().replace(".", "-")


class UniverseProvider:
    def __init__(self, cache_path: Path, cache_hours: int = 24) -> None:
        self.cache_path = cache_path
        self.cache_ttl = timedelta(hours=cache_hours)

    def get_symbols(self, override: list[str] | None = None) -> list[str]:
        if override:
            return sorted({_normalize_symbol(item) for item in override})

        cache = self._read_cache()
        if cache and datetime.now(UTC) - cache[0] <= self.cache_ttl:
            return cache[1]

        try:
            symbols = self._fetch_all()
            self._write_cache(symbols)
            return symbols
        except Exception as exc:
            if cache:
                logger.warning("Universe refresh failed; using stale cache: %s", exc)
                return cache[1]
            raise UniverseUnavailable("cannot load index constituents and no cache exists") from exc

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8), reraise=True)
    def _fetch_html(self, url: str) -> str:
        response = requests.get(
            url,
            timeout=20,
            headers={"User-Agent": "ai-stock-paper-assistant/0.1 (constituent refresh)"},
        )
        response.raise_for_status()
        return response.text

    @staticmethod
    def _extract_column(html: str, candidates: tuple[str, ...]) -> list[str]:
        for table in pd.read_html(StringIO(html)):
            flattened = [
                str(column[-1] if isinstance(column, tuple) else column).strip()
                for column in table.columns
            ]
            for candidate in candidates:
                if candidate in flattened:
                    column = table.columns[flattened.index(candidate)]
                    return [_normalize_symbol(value) for value in table[column].dropna()]

            # Some official pages render the visual header as the first data row.
            for column in table.columns:
                values = [str(value).strip() for value in table[column].tolist()]
                for marker_position, value in enumerate(values):
                    if value in candidates:
                        return [
                            _normalize_symbol(symbol)
                            for symbol in values[marker_position + 1 :]
                            if symbol and symbol.lower() != "nan"
                        ]
        raise UniverseUnavailable(f"none of the ticker columns {candidates!r} were found")

    def _fetch_all(self) -> list[str]:
        sp500 = self._extract_column(self._fetch_html(SP500_URL), ("Symbol", "Ticker"))
        nasdaq100 = self._extract_column(
            self._fetch_html(NASDAQ100_URL), ("Ticker", "Ticker symbol", "Symbol")
        )
        if len(set(sp500)) < 450 or len(set(nasdaq100)) < 90:
            raise UniverseUnavailable(
                f"unexpected universe sizes: S&P 500={len(set(sp500))}, "
                f"Nasdaq-100={len(set(nasdaq100))}"
            )
        symbols = sorted(set(sp500) | set(nasdaq100))
        logger.info(
            "Loaded universe: %d unique tickers (%d S&P 500, %d Nasdaq-100)",
            len(symbols),
            len(set(sp500)),
            len(set(nasdaq100)),
        )
        return symbols

    def _read_cache(self) -> tuple[datetime, list[str]] | None:
        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
            fetched_at = datetime.fromisoformat(payload["fetched_at"])
            if fetched_at.tzinfo is None:
                fetched_at = fetched_at.replace(tzinfo=UTC)
            symbols = sorted({_normalize_symbol(item) for item in payload["symbols"]})
            if not symbols:
                return None
            return fetched_at.astimezone(UTC), symbols
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _write_cache(self, symbols: list[str]) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.cache_path.with_suffix(self.cache_path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(
                {"fetched_at": datetime.now(UTC).isoformat(), "symbols": symbols},
                indent=2,
            ),
            encoding="utf-8",
        )
        temporary.replace(self.cache_path)
