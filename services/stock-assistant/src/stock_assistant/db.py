import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from stock_assistant.adaptive import FEATURE_NAMES, default_weights
from stock_assistant.agent_profiles import is_high_volatility_agent
from stock_assistant.models import Action, NewsArticle, Position, TradeAnalysis, TradeExecution

DEFAULT_AGENTS = (
    ("trend", "USA Trend", "TREND", "US", "USD"),
    ("breakout", "USA Breakout", "BREAKOUT", "US", "USD"),
    ("momentum", "USA High Volatility", "MOMENTUM", "US", "USD"),
    ("hybrid", "USA Hybrid", "HYBRID", "US", "USD"),
    ("europe-trend", "Evropa Trend", "TREND", "EU", "EUR"),
    ("europe-breakout", "Evropa Breakout", "BREAKOUT", "EU", "EUR"),
    ("europe-momentum", "Evropa High Volatility", "MOMENTUM", "EU", "EUR"),
    ("europe-hybrid", "Evropa Hybrid", "HYBRID", "EU", "EUR"),
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    initial_cash REAL NOT NULL CHECK (initial_cash > 0),
    cash REAL NOT NULL CHECK (cash >= 0),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
    ticker TEXT PRIMARY KEY,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    entry_price REAL NOT NULL CHECK (entry_price > 0),
    stop_loss REAL NOT NULL CHECK (stop_loss > 0),
    target_1 REAL NOT NULL CHECK (target_1 > 0),
    target_2 REAL NOT NULL CHECK (target_2 > 0),
    opened_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price REAL NOT NULL CHECK (price > 0),
    realized_pnl REAL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('BUY', 'WATCH', 'HOLD', 'SELL')),
    confidence REAL NOT NULL,
    current_price REAL NOT NULL CHECK (current_price > 0),
    payload_json TEXT NOT NULL,
    executed INTEGER NOT NULL DEFAULT 0 CHECK (executed IN (0, 1)),
    rejection_reason TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('BUY', 'SELL')),
    price REAL NOT NULL CHECK (price > 0),
    stop_loss REAL,
    target_1 REAL,
    fingerprint TEXT NOT NULL,
    sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_ticker_sent ON alerts(ticker, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_ticker_created ON signals(ticker, created_at DESC);

CREATE TABLE IF NOT EXISTS position_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    price REAL NOT NULL CHECK (price > 0),
    unrealized_pnl REAL NOT NULL,
    pnl_percent REAL NOT NULL,
    source_timestamp TEXT NOT NULL,
    sent_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_position_updates_ticker_sent
    ON position_updates(ticker, sent_at DESC);

CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cycle_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    universe_count INTEGER NOT NULL DEFAULT 0,
    valid_count INTEGER NOT NULL DEFAULT 0,
    screened_count INTEGER NOT NULL DEFAULT 0,
    llm_count INTEGER NOT NULL DEFAULT 0,
    error TEXT
);

CREATE TABLE IF NOT EXISTS news_articles (
    fingerprint TEXT PRIMARY KEY,
    ticker TEXT,
    query TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    source TEXT NOT NULL,
    published_at TEXT NOT NULL,
    significance_score INTEGER NOT NULL CHECK (significance_score BETWEEN 0 AND 10),
    sentiment TEXT NOT NULL CHECK (sentiment IN ('POSITIVE', 'NEGATIVE', 'NEUTRAL')),
    discovered_at TEXT NOT NULL,
    alerted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_ticker_published
    ON news_articles(ticker, published_at DESC);

CREATE TABLE IF NOT EXISTS agent_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    strategy TEXT NOT NULL CHECK (strategy IN ('TREND', 'BREAKOUT', 'MOMENTUM', 'HYBRID')),
    market TEXT NOT NULL DEFAULT 'US' CHECK (market IN ('US', 'EU')),
    currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'EUR')),
    initial_cash REAL NOT NULL CHECK (initial_cash > 0),
    cash REAL NOT NULL CHECK (cash >= 0),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_quotes (
    ticker TEXT PRIMARY KEY,
    price REAL NOT NULL CHECK (price > 0),
    source_timestamp TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_positions (
    agent_id INTEGER NOT NULL REFERENCES agent_accounts(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    entry_price REAL NOT NULL CHECK (entry_price > 0),
    stop_loss REAL NOT NULL CHECK (stop_loss > 0),
    target_1 REAL NOT NULL CHECK (target_1 > 0),
    target_2 REAL NOT NULL CHECK (target_2 > 0),
    scanner_score REAL NOT NULL CHECK (scanner_score BETWEEN 0 AND 100),
    opened_at TEXT NOT NULL,
    PRIMARY KEY (agent_id, ticker)
);

CREATE TABLE IF NOT EXISTS agent_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agent_accounts(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    strategy TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price REAL NOT NULL CHECK (price > 0),
    stop_loss REAL,
    target_1 REAL,
    target_2 REAL,
    scanner_score REAL,
    realized_pnl REAL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_trades_agent_created
    ON agent_trades(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_equity_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agent_accounts(id) ON DELETE CASCADE,
    equity REAL NOT NULL CHECK (equity >= 0),
    cash REAL NOT NULL CHECK (cash >= 0),
    unrealized_pnl REAL NOT NULL,
    recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_equity_agent_recorded
    ON agent_equity_snapshots(agent_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS agent_learning_state (
    agent_id INTEGER PRIMARY KEY REFERENCES agent_accounts(id) ON DELETE CASCADE,
    weights_json TEXT NOT NULL,
    decision_threshold REAL NOT NULL CHECK (decision_threshold BETWEEN 0 AND 100),
    base_threshold REAL NOT NULL CHECK (base_threshold BETWEEN 0 AND 100),
    trades_learned INTEGER NOT NULL DEFAULT 0 CHECK (trades_learned >= 0),
    wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
    losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
    cumulative_reward_r REAL NOT NULL DEFAULT 0,
    last_reward_r REAL,
    policy_version INTEGER NOT NULL DEFAULT 1 CHECK (policy_version >= 1),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instrument_names (
    ticker TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_trade_context (
    agent_id INTEGER NOT NULL REFERENCES agent_accounts(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    features_json TEXT NOT NULL,
    base_score REAL NOT NULL CHECK (base_score BETWEEN 0 AND 100),
    decision_score REAL NOT NULL CHECK (decision_score BETWEEN 0 AND 100),
    initial_risk REAL NOT NULL CHECK (initial_risk > 0),
    policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
    created_at TEXT NOT NULL,
    PRIMARY KEY (agent_id, ticker)
);

CREATE TABLE IF NOT EXISTS agent_learning_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES agent_accounts(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    realized_pnl REAL NOT NULL,
    reward_r REAL NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('WIN', 'LOSS', 'FLAT')),
    features_json TEXT NOT NULL,
    weights_before_json TEXT NOT NULL,
    weights_after_json TEXT NOT NULL,
    threshold_before REAL NOT NULL,
    threshold_after REAL NOT NULL,
    lesson TEXT NOT NULL,
    policy_version INTEGER NOT NULL CHECK (policy_version >= 2),
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_learning_events_agent_created
    ON agent_learning_events(agent_id, created_at DESC);
"""


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


class Repository:
    def __init__(
        self,
        path: Path,
        initial_cash: float,
        agent_initial_cash: float = 10_000.0,
        agent_min_score: float = 75.0,
        agent_europe_initial_cash: float = 10_000.0,
        agent_high_volatility_min_score: float = 68.0,
    ) -> None:
        self.path = path
        self.initial_cash = initial_cash
        self.agent_initial_cash = agent_initial_cash
        self.agent_min_score = agent_min_score
        self.agent_europe_initial_cash = agent_europe_initial_cash
        self.agent_high_volatility_min_score = agent_high_volatility_min_score

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")
        try:
            yield connection
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(SCHEMA)
            account_columns = {
                str(row["name"])
                for row in connection.execute("PRAGMA table_info(agent_accounts)")
            }
            if "market" not in account_columns:
                connection.execute(
                    "ALTER TABLE agent_accounts ADD COLUMN market TEXT NOT NULL DEFAULT 'US'"
                )
            if "currency" not in account_columns:
                connection.execute(
                    "ALTER TABLE agent_accounts ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'"
                )
            connection.execute(
                """INSERT OR IGNORE INTO account(id, initial_cash, cash, updated_at)
                   VALUES (1, ?, ?, ?)""",
                (self.initial_cash, self.initial_cash, _utc_now()),
            )
            now = _utc_now()
            connection.executemany(
                """INSERT OR IGNORE INTO agent_accounts
                   (slug, name, strategy, market, currency, initial_cash, cash,
                    enabled, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
                [
                    (
                        slug,
                        name,
                        strategy,
                        market,
                        currency,
                        (
                            self.agent_initial_cash
                            if market == "US"
                            else self.agent_europe_initial_cash
                        ),
                        (
                            self.agent_initial_cash
                            if market == "US"
                            else self.agent_europe_initial_cash
                        ),
                        now,
                        now,
                    )
                    for slug, name, strategy, market, currency in DEFAULT_AGENTS
                ],
            )
            connection.execute(
                """UPDATE agent_accounts SET market = 'US', currency = 'USD'
                   WHERE slug IN ('trend', 'breakout', 'momentum', 'hybrid')"""
            )
            connection.executemany(
                "UPDATE agent_accounts SET name = ? WHERE slug = ?",
                [(name, slug) for slug, name, _strategy, _market, _currency in DEFAULT_AGENTS],
            )
            accounts = connection.execute(
                "SELECT id, slug, strategy FROM agent_accounts ORDER BY id"
            ).fetchall()
            connection.executemany(
                """INSERT OR IGNORE INTO agent_learning_state
                   (agent_id, weights_json, decision_threshold, base_threshold,
                    trades_learned, wins, losses, cumulative_reward_r, last_reward_r,
                    policy_version, updated_at)
                   VALUES (?, ?, ?, ?, 0, 0, 0, 0, NULL, 1, ?)""",
                [
                    (
                        int(account["id"]),
                        json.dumps(default_weights(str(account["strategy"])), sort_keys=True),
                        (
                            self.agent_high_volatility_min_score
                            if is_high_volatility_agent(str(account["slug"]))
                            else self.agent_min_score
                        ),
                        (
                            self.agent_high_volatility_min_score
                            if is_high_volatility_agent(str(account["slug"]))
                            else self.agent_min_score
                        ),
                        now,
                    )
                    for account in accounts
                ],
            )
            connection.executemany(
                """UPDATE agent_learning_state
                   SET decision_threshold = MIN(
                           100, MAX(0, ? + decision_threshold - base_threshold)
                       ),
                       base_threshold = ?
                   WHERE agent_id = ?""",
                [
                    (
                        (
                            self.agent_high_volatility_min_score
                            if is_high_volatility_agent(str(account["slug"]))
                            else self.agent_min_score
                        ),
                        (
                            self.agent_high_volatility_min_score
                            if is_high_volatility_agent(str(account["slug"]))
                            else self.agent_min_score
                        ),
                        int(account["id"]),
                    )
                    for account in accounts
                ],
            )
            connection.execute("PRAGMA optimize")
            connection.commit()

    def healthcheck(self) -> bool:
        try:
            with self.connect() as connection:
                return connection.execute("SELECT 1").fetchone()[0] == 1
        except sqlite3.Error:
            return False

    def get_cash(self) -> float:
        with self.connect() as connection:
            row = connection.execute("SELECT cash FROM account WHERE id = 1").fetchone()
        if row is None:
            raise RuntimeError("paper account is not initialized")
        return float(row["cash"])

    def get_positions(self) -> dict[str, Position]:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM positions ORDER BY ticker").fetchall()
        return {
            row["ticker"]: Position(
                ticker=row["ticker"],
                quantity=row["quantity"],
                entry_price=row["entry_price"],
                stop_loss=row["stop_loss"],
                target_1=row["target_1"],
                target_2=row["target_2"],
                opened_at=datetime.fromisoformat(row["opened_at"]),
            )
            for row in rows
        }

    def open_position(
        self,
        *,
        ticker: str,
        quantity: int,
        price: float,
        stop_loss: float,
        target_1: float,
        target_2: float,
        reason: str,
    ) -> TradeExecution:
        now = datetime.now(UTC)
        cost = quantity * price
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            account = connection.execute("SELECT cash FROM account WHERE id = 1").fetchone()
            if account is None or float(account["cash"]) + 1e-9 < cost:
                connection.rollback()
                raise ValueError("insufficient paper cash")
            if connection.execute(
                "SELECT 1 FROM positions WHERE ticker = ?", (ticker,)
            ).fetchone():
                connection.rollback()
                raise ValueError(f"position {ticker} already exists")
            connection.execute(
                """INSERT INTO positions
                   (ticker, quantity, entry_price, stop_loss, target_1, target_2, opened_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (ticker, quantity, price, stop_loss, target_1, target_2, now.isoformat()),
            )
            connection.execute(
                "UPDATE account SET cash = cash - ?, updated_at = ? WHERE id = 1",
                (cost, now.isoformat()),
            )
            connection.execute(
                """INSERT INTO trades
                   (ticker, side, quantity, price, realized_pnl, reason, created_at)
                   VALUES (?, 'BUY', ?, ?, NULL, ?, ?)""",
                (ticker, quantity, price, reason, now.isoformat()),
            )
            connection.commit()
        return TradeExecution(
            ticker=ticker,
            side="BUY",
            quantity=quantity,
            price=price,
            reason=reason,
            executed_at=now,
        )

    def close_position(self, ticker: str, price: float, reason: str) -> TradeExecution:
        now = datetime.now(UTC)
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM positions WHERE ticker = ?", (ticker,)
            ).fetchone()
            if row is None:
                connection.rollback()
                raise ValueError(f"no open position for {ticker}")
            quantity = int(row["quantity"])
            pnl = (price - float(row["entry_price"])) * quantity
            connection.execute("DELETE FROM positions WHERE ticker = ?", (ticker,))
            connection.execute(
                "UPDATE account SET cash = cash + ?, updated_at = ? WHERE id = 1",
                (quantity * price, now.isoformat()),
            )
            connection.execute(
                """INSERT INTO trades
                   (ticker, side, quantity, price, realized_pnl, reason, created_at)
                   VALUES (?, 'SELL', ?, ?, ?, ?, ?)""",
                (ticker, quantity, price, pnl, reason, now.isoformat()),
            )
            connection.commit()
        return TradeExecution(
            ticker=ticker,
            side="SELL",
            quantity=quantity,
            price=price,
            realized_pnl=pnl,
            reason=reason,
            executed_at=now,
        )

    def save_signal(
        self,
        analysis: TradeAnalysis,
        current_price: float,
        *,
        executed: bool,
        rejection_reason: str | None = None,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO signals
                   (ticker, action, confidence, current_price, payload_json, executed,
                    rejection_reason, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    analysis.ticker,
                    analysis.action.value,
                    analysis.confidence,
                    current_price,
                    analysis.model_dump_json(),
                    int(executed),
                    rejection_reason,
                    _utc_now(),
                ),
            )
            connection.commit()

    def last_alert(self, ticker: str) -> sqlite3.Row | None:
        with self.connect() as connection:
            return connection.execute(
                "SELECT * FROM alerts WHERE ticker = ? ORDER BY id DESC LIMIT 1", (ticker,)
            ).fetchone()

    def record_alert(
        self,
        ticker: str,
        action: Action,
        price: float,
        stop_loss: float | None,
        target_1: float | None,
        fingerprint: str,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO alerts
                   (ticker, action, price, stop_loss, target_1, fingerprint, sent_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (ticker, action.value, price, stop_loss, target_1, fingerprint, _utc_now()),
            )
            connection.commit()

    def last_position_update(self, ticker: str) -> sqlite3.Row | None:
        with self.connect() as connection:
            return connection.execute(
                """SELECT * FROM position_updates
                   WHERE ticker = ? ORDER BY id DESC LIMIT 1""",
                (ticker,),
            ).fetchone()

    def record_position_update(
        self,
        *,
        ticker: str,
        price: float,
        unrealized_pnl: float,
        pnl_percent: float,
        source_timestamp: datetime,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO position_updates
                   (ticker, price, unrealized_pnl, pnl_percent, source_timestamp, sent_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    ticker,
                    price,
                    unrealized_pnl,
                    pnl_percent,
                    source_timestamp.isoformat(),
                    _utc_now(),
                ),
            )
            connection.commit()

    def get_state(self, key: str) -> str | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT value FROM app_state WHERE key = ?", (key,)
            ).fetchone()
        return str(row["value"]) if row is not None else None

    def set_state(self, key: str, value: str) -> None:
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO app_state(key, value, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET
                       value = excluded.value,
                       updated_at = excluded.updated_at""",
                (key, value, _utc_now()),
            )
            connection.commit()

    def save_news_article(self, article: NewsArticle) -> bool:
        """Persist an article once and return whether it was newly discovered."""
        with self.connect() as connection:
            cursor = connection.execute(
                """INSERT OR IGNORE INTO news_articles
                   (fingerprint, ticker, query, title, url, source, published_at,
                    significance_score, sentiment, discovered_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    article.fingerprint,
                    article.ticker,
                    article.query,
                    article.title,
                    article.url,
                    article.source,
                    article.published_at.isoformat(),
                    article.significance_score,
                    article.sentiment,
                    _utc_now(),
                ),
            )
            connection.commit()
            return cursor.rowcount == 1

    def mark_news_alerted(self, fingerprint: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE news_articles SET alerted_at = ? WHERE fingerprint = ?",
                (_utc_now(), fingerprint),
            )
            connection.commit()

    def pending_news(
        self,
        *,
        minimum_score: int,
        since: datetime,
        limit: int,
    ) -> list[NewsArticle]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT fingerprint, ticker, query, title, url, source, published_at,
                          significance_score, sentiment
                   FROM news_articles
                   WHERE alerted_at IS NULL AND significance_score >= ? AND published_at >= ?
                   ORDER BY published_at DESC LIMIT ?""",
                (minimum_score, since.isoformat(), limit),
            ).fetchall()
        return [
            NewsArticle(
                fingerprint=row["fingerprint"],
                ticker=row["ticker"],
                query=row["query"],
                title=row["title"],
                url=row["url"],
                source=row["source"],
                published_at=datetime.fromisoformat(row["published_at"]),
                significance_score=row["significance_score"],
                sentiment=row["sentiment"],
            )
            for row in rows
        ]

    def recent_news(
        self,
        *,
        ticker: str | None = None,
        limit: int = 10,
        since: datetime | None = None,
    ) -> list[NewsArticle]:
        clauses: list[str] = []
        parameters: list[object] = []
        if ticker is not None:
            clauses.append("ticker = ?")
            parameters.append(ticker.upper())
        if since is not None:
            clauses.append("published_at >= ?")
            parameters.append(since.isoformat())
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        parameters.append(limit)
        with self.connect() as connection:
            rows = connection.execute(
                f"""SELECT fingerprint, ticker, query, title, url, source, published_at,
                           significance_score, sentiment
                    FROM news_articles {where}
                    ORDER BY published_at DESC LIMIT ?""",
                parameters,
            ).fetchall()
        return [
            NewsArticle(
                fingerprint=row["fingerprint"],
                ticker=row["ticker"],
                query=row["query"],
                title=row["title"],
                url=row["url"],
                source=row["source"],
                published_at=datetime.fromisoformat(row["published_at"]),
                significance_score=row["significance_score"],
                sentiment=row["sentiment"],
            )
            for row in rows
        ]

    def start_cycle(self) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO cycle_runs(started_at, status) VALUES (?, 'RUNNING')", (_utc_now(),)
            )
            connection.commit()
            return int(cursor.lastrowid)

    def finish_cycle(
        self,
        cycle_id: int,
        *,
        status: str,
        universe_count: int = 0,
        valid_count: int = 0,
        screened_count: int = 0,
        llm_count: int = 0,
        error: str | None = None,
    ) -> None:
        with self.connect() as connection:
            connection.execute(
                """UPDATE cycle_runs
                   SET finished_at = ?, status = ?, universe_count = ?, valid_count = ?,
                       screened_count = ?, llm_count = ?, error = ?
                   WHERE id = ?""",
                (
                    _utc_now(),
                    status,
                    universe_count,
                    valid_count,
                    screened_count,
                    llm_count,
                    error,
                    cycle_id,
                ),
            )
            connection.commit()

    def latest_cycle(self) -> dict[str, object] | None:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT id, started_at, finished_at, status, universe_count,
                          valid_count, screened_count, llm_count, error
                   FROM cycle_runs ORDER BY id DESC LIMIT 1"""
            ).fetchone()
        return dict(row) if row is not None else None

    def dump_account(self) -> dict[str, object]:
        with self.connect() as connection:
            account = dict(connection.execute("SELECT * FROM account WHERE id = 1").fetchone())
            trades = [dict(row) for row in connection.execute(
                "SELECT * FROM trades ORDER BY id DESC LIMIT 20"
            )]
        return {"account": account, "positions": self.get_positions(), "recent_trades": trades}

    def save_market_quotes(self, snapshots: dict[str, object]) -> None:
        rows = [
            (
                ticker,
                float(snapshot.current_price),
                snapshot.timestamp.isoformat(),
                _utc_now(),
            )
            for ticker, snapshot in snapshots.items()
        ]
        if not rows:
            return
        with self.connect() as connection:
            connection.executemany(
                """INSERT INTO market_quotes(ticker, price, source_timestamp, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(ticker) DO UPDATE SET
                       price = excluded.price,
                       source_timestamp = excluded.source_timestamp,
                       updated_at = excluded.updated_at""",
                rows,
            )
            connection.commit()

    def missing_instrument_names(self, tickers: set[str]) -> list[str]:
        if not tickers:
            return []
        placeholders = ",".join("?" for _ in tickers)
        with self.connect() as connection:
            rows = connection.execute(
                f"SELECT ticker FROM instrument_names WHERE ticker IN ({placeholders})",
                sorted(tickers),
            ).fetchall()
        known = {str(row["ticker"]) for row in rows}
        return sorted(tickers - known)

    def save_instrument_names(self, names: dict[str, str]) -> None:
        rows = [
            (ticker, name.strip()[:200], _utc_now())
            for ticker, name in names.items()
            if ticker and name.strip()
        ]
        if not rows:
            return
        with self.connect() as connection:
            connection.executemany(
                """INSERT INTO instrument_names(ticker, name, updated_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(ticker) DO UPDATE SET
                       name = excluded.name,
                       updated_at = excluded.updated_at""",
                rows,
            )
            connection.commit()

    def get_agent_accounts(
        self, market: str | None = None
    ) -> list[dict[str, object]]:
        with self.connect() as connection:
            if market is None:
                rows = connection.execute(
                    "SELECT * FROM agent_accounts ORDER BY market DESC, id"
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM agent_accounts WHERE market = ? ORDER BY id",
                    (market,),
                ).fetchall()
        return [dict(row) for row in rows]

    def get_agent_position_tickers(self, market: str) -> set[str]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT DISTINCT p.ticker
                   FROM agent_positions p
                   JOIN agent_accounts a ON a.id = p.agent_id
                   WHERE a.market = ?""",
                (market,),
            ).fetchall()
        return {str(row["ticker"]) for row in rows}

    def get_agent_learning_state(self, agent_id: int) -> dict[str, object]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM agent_learning_state WHERE agent_id = ?",
                (agent_id,),
            ).fetchone()
        if row is None:
            raise ValueError("agentní model učení neexistuje")
        state = dict(row)
        state["weights"] = json.loads(str(state.pop("weights_json")))
        return state

    def get_agent_trade_context(
        self, agent_id: int, ticker: str
    ) -> dict[str, object] | None:
        with self.connect() as connection:
            row = connection.execute(
                """SELECT * FROM agent_trade_context
                   WHERE agent_id = ? AND ticker = ?""",
                (agent_id, ticker),
            ).fetchone()
        if row is None:
            return None
        context = dict(row)
        context["features"] = json.loads(str(context.pop("features_json")))
        return context

    def get_agent_positions(self, agent_id: int) -> list[dict[str, object]]:
        with self.connect() as connection:
            rows = connection.execute(
                """SELECT p.*, COALESCE(n.name, p.ticker) AS company_name,
                          COALESCE(q.price, p.entry_price) AS current_price,
                          q.source_timestamp
                   FROM agent_positions p
                   LEFT JOIN market_quotes q ON q.ticker = p.ticker
                   LEFT JOIN instrument_names n ON n.ticker = p.ticker
                   WHERE p.agent_id = ? ORDER BY p.ticker""",
                (agent_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def agent_runtime_state(self, agent_id: int) -> dict[str, object]:
        with self.connect() as connection:
            account_row = connection.execute(
                "SELECT * FROM agent_accounts WHERE id = ?", (agent_id,)
            ).fetchone()
            if account_row is None:
                raise ValueError("agent neexistuje")
            positions = connection.execute(
                """SELECT p.*, COALESCE(n.name, p.ticker) AS company_name,
                          COALESCE(q.price, p.entry_price) AS current_price
                   FROM agent_positions p
                   LEFT JOIN market_quotes q ON q.ticker = p.ticker
                   LEFT JOIN instrument_names n ON n.ticker = p.ticker
                   WHERE p.agent_id = ?""",
                (agent_id,),
            ).fetchall()
        market_value = sum(float(row["current_price"]) * int(row["quantity"]) for row in positions)
        unrealized = sum(
            (float(row["current_price"]) - float(row["entry_price"])) * int(row["quantity"])
            for row in positions
        )
        portfolio_risk = sum(
            max(float(row["entry_price"]) - float(row["stop_loss"]), 0)
            * int(row["quantity"])
            for row in positions
        )
        account = dict(account_row)
        account.update(
            {
                "positions": [dict(row) for row in positions],
                "market_value": market_value,
                "unrealized_pnl": unrealized,
                "equity": float(account_row["cash"]) + market_value,
                "portfolio_risk": portfolio_risk,
            }
        )
        return account

    def agent_open_position(
        self,
        *,
        agent_id: int,
        ticker: str,
        quantity: int,
        price: float,
        stop_loss: float,
        target_1: float,
        target_2: float,
        scanner_score: float,
        reason: str,
        features: dict[str, float],
        base_score: float,
        decision_score: float,
        initial_risk: float,
        policy_version: int,
    ) -> None:
        if not (quantity > 0 and 0 < stop_loss < price < target_1 <= target_2):
            raise ValueError("neplatné úrovně agentní PAPER pozice")
        valid_features = (
            set(features) == set(FEATURE_NAMES)
            and all(
                isinstance(features[name], (int, float))
                and 0 <= float(features[name]) <= 1
                for name in FEATURE_NAMES
            )
        )
        if not (
            0 <= base_score <= 100
            and 0 <= decision_score <= 100
            and initial_risk > 0
            and policy_version >= 1
            and valid_features
        ):
            raise ValueError("neplatný kontext agentního rozhodnutí")
        now = _utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            account = connection.execute(
                "SELECT cash, strategy, enabled FROM agent_accounts WHERE id = ?",
                (agent_id,),
            ).fetchone()
            cost = quantity * price
            if account is None or not account["enabled"]:
                connection.rollback()
                raise ValueError("agent není aktivní")
            if float(account["cash"]) + 1e-9 < cost:
                connection.rollback()
                raise ValueError("agent nemá dostatek PAPER hotovosti")
            if connection.execute(
                "SELECT 1 FROM agent_positions WHERE agent_id = ? AND ticker = ?",
                (agent_id, ticker),
            ).fetchone():
                connection.rollback()
                raise ValueError("agent už tuto pozici drží")
            connection.execute(
                """INSERT INTO agent_positions
                   (agent_id, ticker, quantity, entry_price, stop_loss, target_1, target_2,
                    scanner_score, opened_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    agent_id,
                    ticker,
                    quantity,
                    price,
                    stop_loss,
                    target_1,
                    target_2,
                    scanner_score,
                    now,
                ),
            )
            connection.execute(
                "UPDATE agent_accounts SET cash = cash - ?, updated_at = ? WHERE id = ?",
                (cost, now, agent_id),
            )
            connection.execute(
                """INSERT INTO agent_trades
                   (agent_id, ticker, strategy, side, quantity, price, stop_loss, target_1,
                    target_2, scanner_score, realized_pnl, reason, created_at)
                   VALUES (?, ?, ?, 'BUY', ?, ?, ?, ?, ?, ?, NULL, ?, ?)""",
                (
                    agent_id,
                    ticker,
                    account["strategy"],
                    quantity,
                    price,
                    stop_loss,
                    target_1,
                    target_2,
                    scanner_score,
                    reason,
                    now,
                ),
            )
            connection.execute(
                """INSERT OR REPLACE INTO agent_trade_context
                   (agent_id, ticker, features_json, base_score, decision_score,
                    initial_risk, policy_version, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    agent_id,
                    ticker,
                    json.dumps(features, sort_keys=True),
                    base_score,
                    decision_score,
                    initial_risk,
                    policy_version,
                    now,
                ),
            )
            connection.commit()

    def agent_close_position(
        self,
        *,
        agent_id: int,
        ticker: str,
        price: float,
        reason: str,
        learning_update: dict[str, object] | None = None,
    ) -> float:
        now = _utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            position = connection.execute(
                """SELECT p.*, a.strategy FROM agent_positions p
                   JOIN agent_accounts a ON a.id = p.agent_id
                   WHERE p.agent_id = ? AND p.ticker = ?""",
                (agent_id, ticker),
            ).fetchone()
            if position is None:
                connection.rollback()
                raise ValueError("agentní pozice neexistuje")
            learning_context = connection.execute(
                """SELECT * FROM agent_trade_context
                   WHERE agent_id = ? AND ticker = ?""",
                (agent_id, ticker),
            ).fetchone()
            learning_state = connection.execute(
                "SELECT * FROM agent_learning_state WHERE agent_id = ?",
                (agent_id,),
            ).fetchone()
            quantity = int(position["quantity"])
            realized_pnl = (price - float(position["entry_price"])) * quantity
            connection.execute(
                "DELETE FROM agent_positions WHERE agent_id = ? AND ticker = ?",
                (agent_id, ticker),
            )
            connection.execute(
                "UPDATE agent_accounts SET cash = cash + ?, updated_at = ? WHERE id = ?",
                (price * quantity, now, agent_id),
            )
            connection.execute(
                """INSERT INTO agent_trades
                   (agent_id, ticker, strategy, side, quantity, price, stop_loss, target_1,
                    target_2, scanner_score, realized_pnl, reason, created_at)
                   VALUES (?, ?, ?, 'SELL', ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    agent_id,
                    ticker,
                    position["strategy"],
                    quantity,
                    price,
                    position["stop_loss"],
                    position["target_1"],
                    position["target_2"],
                    position["scanner_score"],
                    realized_pnl,
                    reason,
                    now,
                ),
            )
            if (
                learning_update is not None
                and learning_context is not None
                and learning_state is not None
            ):
                updated_weights = learning_update.get("weights")
                updated_threshold = float(learning_update.get("threshold", -1))
                reward_r = float(learning_update.get("reward_r", 0))
                lesson = str(learning_update.get("lesson", "")).strip()
                valid_weights = (
                    isinstance(updated_weights, dict)
                    and set(updated_weights) == set(FEATURE_NAMES)
                    and all(
                        isinstance(updated_weights[name], (int, float))
                        and 0.25 <= float(updated_weights[name]) <= 3
                        for name in FEATURE_NAMES
                    )
                )
                if not (
                    valid_weights
                    and 0 <= updated_threshold <= 100
                    and lesson
                ):
                    connection.rollback()
                    raise ValueError("neplatná aktualizace agentního učení")
                if realized_pnl > 0:
                    outcome = "WIN"
                elif realized_pnl < 0:
                    outcome = "LOSS"
                else:
                    outcome = "FLAT"
                next_version = int(learning_state["policy_version"]) + 1
                connection.execute(
                    """UPDATE agent_learning_state
                       SET weights_json = ?, decision_threshold = ?,
                           trades_learned = trades_learned + 1,
                           wins = wins + ?, losses = losses + ?,
                           cumulative_reward_r = cumulative_reward_r + ?,
                           last_reward_r = ?, policy_version = ?, updated_at = ?
                       WHERE agent_id = ?""",
                    (
                        json.dumps(updated_weights, sort_keys=True),
                        updated_threshold,
                        1 if outcome == "WIN" else 0,
                        1 if outcome == "LOSS" else 0,
                        reward_r,
                        reward_r,
                        next_version,
                        now,
                        agent_id,
                    ),
                )
                connection.execute(
                    """INSERT INTO agent_learning_events
                       (agent_id, ticker, realized_pnl, reward_r, outcome,
                        features_json, weights_before_json, weights_after_json,
                        threshold_before, threshold_after, lesson, policy_version,
                        created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        agent_id,
                        ticker,
                        realized_pnl,
                        reward_r,
                        outcome,
                        learning_context["features_json"],
                        learning_state["weights_json"],
                        json.dumps(updated_weights, sort_keys=True),
                        learning_state["decision_threshold"],
                        updated_threshold,
                        lesson,
                        next_version,
                        now,
                    ),
                )
            connection.execute(
                "DELETE FROM agent_trade_context WHERE agent_id = ? AND ticker = ?",
                (agent_id, ticker),
            )
            connection.commit()
        return realized_pnl

    def record_agent_equity(self, agent_id: int) -> None:
        state = self.agent_runtime_state(agent_id)
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO agent_equity_snapshots
                   (agent_id, equity, cash, unrealized_pnl, recorded_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    agent_id,
                    state["equity"],
                    state["cash"],
                    state["unrealized_pnl"],
                    _utc_now(),
                ),
            )
            connection.commit()

    def reset_agent_capital(
        self,
        agent_id: int,
        capital: float,
        *,
        reset_history: bool,
    ) -> None:
        if not (capital > 0 and capital <= 1_000_000_000):
            raise ValueError("kapitál musí být mezi 0 a 1 miliardou USD")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            exists = connection.execute(
                "SELECT strategy FROM agent_accounts WHERE id = ?", (agent_id,)
            ).fetchone()
            if exists is None:
                connection.rollback()
                raise ValueError("agent neexistuje")
            activity = connection.execute(
                """SELECT
                       EXISTS(SELECT 1 FROM agent_positions WHERE agent_id = ?) OR
                       EXISTS(SELECT 1 FROM agent_trades WHERE agent_id = ?) OR
                       EXISTS(
                           SELECT 1 FROM agent_equity_snapshots WHERE agent_id = ?
                       ) OR EXISTS(
                           SELECT 1 FROM agent_learning_events WHERE agent_id = ?
                       ) AS has_activity""",
                (agent_id, agent_id, agent_id, agent_id),
            ).fetchone()["has_activity"]
            if activity and not reset_history:
                connection.rollback()
                raise ValueError("agent má historii nebo pozice; potvrďte reset portfolia")
            if reset_history:
                connection.execute("DELETE FROM agent_positions WHERE agent_id = ?", (agent_id,))
                connection.execute("DELETE FROM agent_trades WHERE agent_id = ?", (agent_id,))
                connection.execute(
                    "DELETE FROM agent_equity_snapshots WHERE agent_id = ?", (agent_id,)
                )
                connection.execute(
                    "DELETE FROM agent_trade_context WHERE agent_id = ?", (agent_id,)
                )
                connection.execute(
                    "DELETE FROM agent_learning_events WHERE agent_id = ?", (agent_id,)
                )
                connection.execute(
                    """UPDATE agent_learning_state
                       SET weights_json = ?, decision_threshold = base_threshold,
                           trades_learned = 0, wins = 0, losses = 0,
                           cumulative_reward_r = 0, last_reward_r = NULL,
                           policy_version = 1, updated_at = ?
                       WHERE agent_id = ?""",
                    (
                        json.dumps(
                            default_weights(str(exists["strategy"])), sort_keys=True
                        ),
                        _utc_now(),
                        agent_id,
                    ),
                )
            connection.execute(
                """UPDATE agent_accounts
                   SET initial_cash = ?, cash = ?, updated_at = ? WHERE id = ?""",
                (capital, capital, _utc_now(), agent_id),
            )
            connection.commit()

    def rebase_agent_capital(self, agent_id: int, capital: float) -> None:
        """Increase PAPER capital while preserving positions, trades and learning."""
        if not (capital > 0 and capital <= 1_000_000_000):
            raise ValueError("kapitál musí být mezi 0 a 1 miliardou")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            account = connection.execute(
                "SELECT cash FROM agent_accounts WHERE id = ?", (agent_id,)
            ).fetchone()
            if account is None:
                connection.rollback()
                raise ValueError("agent neexistuje")
            market_value = connection.execute(
                """SELECT COALESCE(SUM(
                           COALESCE(q.price, p.entry_price) * p.quantity
                       ), 0) AS market_value
                   FROM agent_positions p
                   LEFT JOIN market_quotes q ON q.ticker = p.ticker
                   WHERE p.agent_id = ?""",
                (agent_id,),
            ).fetchone()["market_value"]
            current_equity = float(account["cash"]) + float(market_value)
            if capital < current_equity - 1e-9:
                connection.rollback()
                raise ValueError(
                    f"zachování historie vyžaduje kapitál nejméně {current_equity:.2f}"
                )
            connection.execute(
                """UPDATE agent_accounts
                   SET initial_cash = ?, cash = cash + ?, updated_at = ?
                   WHERE id = ?""",
                (capital, capital - current_equity, _utc_now(), agent_id),
            )
            connection.commit()

    def agent_dashboard(self) -> list[dict[str, object]]:
        dashboard: list[dict[str, object]] = []
        with self.connect() as connection:
            accounts = connection.execute("SELECT * FROM agent_accounts ORDER BY id").fetchall()
            for account_row in accounts:
                agent_id = int(account_row["id"])
                positions = connection.execute(
                    """SELECT p.*, COALESCE(n.name, p.ticker) AS company_name,
                              COALESCE(q.price, p.entry_price) AS current_price
                       FROM agent_positions p
                       LEFT JOIN market_quotes q ON q.ticker = p.ticker
                       LEFT JOIN instrument_names n ON n.ticker = p.ticker
                       WHERE p.agent_id = ? ORDER BY p.ticker""",
                    (agent_id,),
                ).fetchall()
                closed = connection.execute(
                    """SELECT realized_pnl FROM agent_trades
                       WHERE agent_id = ? AND side = 'SELL' ORDER BY id""",
                    (agent_id,),
                ).fetchall()
                equity_rows = connection.execute(
                    """SELECT equity, recorded_at FROM agent_equity_snapshots
                       WHERE agent_id = ? ORDER BY id""",
                    (agent_id,),
                ).fetchall()
                recent_trades = connection.execute(
                    """SELECT ticker, side, quantity, price, realized_pnl, reason, created_at
                       FROM agent_trades WHERE agent_id = ? ORDER BY id DESC LIMIT 10""",
                    (agent_id,),
                ).fetchall()
                learning_state = connection.execute(
                    "SELECT * FROM agent_learning_state WHERE agent_id = ?",
                    (agent_id,),
                ).fetchone()
                learning_events = connection.execute(
                    """SELECT ticker, realized_pnl, reward_r, outcome, lesson,
                              policy_version, created_at
                       FROM agent_learning_events
                       WHERE agent_id = ? ORDER BY id DESC LIMIT 8""",
                    (agent_id,),
                ).fetchall()
                market_value = sum(
                    float(row["current_price"]) * int(row["quantity"]) for row in positions
                )
                unrealized = sum(
                    (float(row["current_price"]) - float(row["entry_price"]))
                    * int(row["quantity"])
                    for row in positions
                )
                equity = float(account_row["cash"]) + market_value
                initial_cash = float(account_row["initial_cash"])
                pnl_values = [float(row["realized_pnl"]) for row in closed]
                wins = [value for value in pnl_values if value > 0]
                losses = [value for value in pnl_values if value < 0]
                learning = None
                if learning_state is not None:
                    learning = {
                        "weights": json.loads(str(learning_state["weights_json"])),
                        "decision_threshold": learning_state["decision_threshold"],
                        "base_threshold": learning_state["base_threshold"],
                        "trades_learned": learning_state["trades_learned"],
                        "wins": learning_state["wins"],
                        "losses": learning_state["losses"],
                        "cumulative_reward_r": learning_state["cumulative_reward_r"],
                        "last_reward_r": learning_state["last_reward_r"],
                        "policy_version": learning_state["policy_version"],
                        "updated_at": learning_state["updated_at"],
                        "recent_lessons": [dict(row) for row in learning_events],
                    }
                peak = 0.0
                max_drawdown = 0.0
                curve = []
                for row in equity_rows:
                    value = float(row["equity"])
                    peak = max(peak, value)
                    if peak > 0:
                        max_drawdown = min(max_drawdown, value / peak - 1)
                    curve.append({"equity": value, "time": row["recorded_at"]})
                dashboard.append(
                    {
                        **dict(account_row),
                        "equity": equity,
                        "market_value": market_value,
                        "unrealized_pnl": unrealized,
                        "total_return_percent": (equity / initial_cash - 1) * 100,
                        "realized_pnl": sum(pnl_values),
                        "open_positions": [dict(row) for row in positions],
                        "closed_trades": len(pnl_values),
                        "win_rate": (len(wins) / len(pnl_values) * 100) if pnl_values else 0.0,
                        "profit_factor": (
                            sum(wins) / abs(sum(losses))
                            if losses
                            else (None if not wins else 999.0)
                        ),
                        "max_drawdown_percent": max_drawdown * 100,
                        "equity_curve": curve[-200:],
                        "recent_trades": [dict(row) for row in recent_trades],
                        "learning": learning,
                    }
                )
        return dashboard
