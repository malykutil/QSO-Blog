export type TradingPosition = {
  ticker: string;
  quantity: number;
  entry_price: number;
  stop_loss: number;
  target_1: number;
  target_2: number;
  scanner_score: number;
  opened_at: string;
  current_price: number;
};

export type EquityPoint = {
  equity: number;
  time: string;
};

export type TradingAgent = {
  id: number;
  slug: string;
  name: string;
  strategy: "TREND" | "BREAKOUT" | "MOMENTUM" | "HYBRID";
  initial_cash: number;
  cash: number;
  enabled: number;
  equity: number;
  market_value: number;
  unrealized_pnl: number;
  total_return_percent: number;
  realized_pnl: number;
  open_positions: TradingPosition[];
  closed_trades: number;
  win_rate: number;
  profit_factor: number | null;
  max_drawdown_percent: number;
  equity_curve: EquityPoint[];
};

export type TradingNews = {
  fingerprint: string;
  ticker: string | null;
  title: string;
  url: string;
  source: string;
  published_at: string;
  significance_score: number;
  sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
};

export type TradingCycleState = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  universe_count: number;
  valid_count: number;
  screened_count: number;
  llm_count: number;
  error: string | null;
};

export type TradingEngineState = {
  data_source: "Yahoo Finance OHLCV";
  interval: "5m";
  last_cycle: TradingCycleState | null;
};

export type TradingDashboardPayload = {
  mode: "PAPER";
  scanner_interval_minutes: number;
  server_time: string;
  engine: TradingEngineState;
  agents: TradingAgent[];
  recent_news: TradingNews[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAgent(value: unknown): value is TradingAgent {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.id) &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    ["TREND", "BREAKOUT", "MOMENTUM", "HYBRID"].includes(String(value.strategy)) &&
    isFiniteNumber(value.initial_cash) &&
    isFiniteNumber(value.cash) &&
    isFiniteNumber(value.equity) &&
    isFiniteNumber(value.total_return_percent) &&
    isFiniteNumber(value.win_rate) &&
    isFiniteNumber(value.max_drawdown_percent) &&
    Array.isArray(value.open_positions) &&
    value.open_positions.length <= 50 &&
    Array.isArray(value.equity_curve) &&
    value.equity_curve.length <= 200
  );
}

export function isTradingDashboardPayload(value: unknown): value is TradingDashboardPayload {
  if (!isRecord(value) || value.mode !== "PAPER") return false;
  const engine = value.engine;
  return (
    isFiniteNumber(value.scanner_interval_minutes) &&
    typeof value.server_time === "string" &&
    isRecord(engine) &&
    engine.data_source === "Yahoo Finance OHLCV" &&
    engine.interval === "5m" &&
    (engine.last_cycle === null ||
      (isRecord(engine.last_cycle) &&
        typeof engine.last_cycle.status === "string" &&
        typeof engine.last_cycle.started_at === "string")) &&
    Array.isArray(value.agents) &&
    value.agents.length === 4 &&
    value.agents.every(isAgent) &&
    Array.isArray(value.recent_news) &&
    value.recent_news.length <= 50
  );
}
