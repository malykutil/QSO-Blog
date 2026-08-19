import logging
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import pandas as pd
import requests
import yfinance as yf
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


def _chunks(items: list[str], size: int) -> Iterable[list[str]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


class YahooMarketDataProvider:
    """Batch OHLCV source for paper trading. Missing symbols are omitted, never fabricated."""

    def __init__(self, period: str = "10d", interval: str = "5m", batch_size: int = 50) -> None:
        self.period = period
        self.interval = interval
        self.batch_size = batch_size

    def fetch(self, symbols: list[str]) -> dict[str, pd.DataFrame]:
        frames: dict[str, pd.DataFrame] = {}
        for batch in _chunks(symbols, self.batch_size):
            try:
                raw = self._download(batch)
                frames.update(self._split(raw, batch))
            except Exception:
                logger.exception("Market data batch failed (%s ...)", ",".join(batch[:3]))
        return frames

    def fetch_names(self, symbols: list[str]) -> dict[str, str]:
        """Resolve display names only for uncached held symbols."""
        unique = sorted(set(symbols))
        if not unique:
            return {}
        with ThreadPoolExecutor(max_workers=min(5, len(unique))) as executor:
            results = executor.map(self._fetch_name, unique)
        return {
            symbol: name
            for symbol, name in zip(unique, results, strict=True)
            if name is not None
        }

    @staticmethod
    def _fetch_name(symbol: str) -> str | None:
        try:
            response = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol, safe='')}",
                params={"range": "1d", "interval": "1d"},
                timeout=15,
                headers={"User-Agent": "ai-stock-paper-assistant/0.1"},
            )
            response.raise_for_status()
            result = response.json().get("chart", {}).get("result") or []
            if not result:
                return None
            meta = result[0].get("meta") or {}
            name = meta.get("longName") or meta.get("shortName")
            if not isinstance(name, str) or not name.strip():
                return None
            return name.strip()[:200]
        except Exception as exc:
            logger.warning(
                "Company name lookup failed ticker=%s error_type=%s",
                symbol,
                type(exc).__name__,
            )
            return None

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8), reraise=True)
    def _download(self, symbols: list[str]) -> pd.DataFrame:
        result = yf.download(
            tickers=symbols,
            period=self.period,
            interval=self.interval,
            group_by="ticker",
            auto_adjust=False,
            prepost=False,
            threads=True,
            progress=False,
            timeout=30,
        )
        if result is None or result.empty:
            raise RuntimeError("market data provider returned no rows")
        return result

    @staticmethod
    def _split(raw: pd.DataFrame, symbols: list[str]) -> dict[str, pd.DataFrame]:
        output: dict[str, pd.DataFrame] = {}
        for symbol in symbols:
            try:
                if isinstance(raw.columns, pd.MultiIndex):
                    if symbol in raw.columns.get_level_values(0):
                        frame = raw[symbol].copy()
                    elif symbol in raw.columns.get_level_values(1):
                        frame = raw.xs(symbol, axis=1, level=1).copy()
                    else:
                        continue
                elif len(symbols) == 1:
                    frame = raw.copy()
                else:
                    continue
                frame.columns = [str(column).title() for column in frame.columns]
                required = ["Open", "High", "Low", "Close", "Volume"]
                if not set(required).issubset(frame.columns):
                    continue
                frame = frame[required].dropna(how="all")
                if not frame.empty:
                    output[symbol] = frame
            except (KeyError, ValueError):
                logger.exception("Cannot parse market data for %s", symbol)
        return output
