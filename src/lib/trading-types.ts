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

export type TradingLearningLesson = {
  ticker: string;
  realized_pnl: number;
  reward_r: number;
  outcome: "WIN" | "LOSS" | "FLAT";
  lesson: string;
  policy_version: number;
  created_at: string;
};

export type TradingLearningState = {
  weights: Record<"trend" | "momentum" | "volume" | "breakout" | "quality", number>;
  decision_threshold: number;
  base_threshold: number;
  trades_learned: number;
  wins: number;
  losses: number;
  cumulative_reward_r: number;
  last_reward_r: number | null;
  policy_version: number;
  updated_at: string;
  recent_lessons: TradingLearningLesson[];
};

export type TradingAgent = {
  id: number;
  slug: string;
  name: string;
  strategy: "TREND" | "BREAKOUT" | "MOMENTUM" | "HYBRID";
  market: "US" | "EU";
  currency: "USD" | "EUR";
  risk_profile: "STANDARD" | "HIGH_VOLATILITY";
  risk_per_trade_percent: number;
  max_portfolio_risk_percent: number;
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
  learning: TradingLearningState;
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
  markets: Record<"EU" | "US", TradingMarketState>;
};

export type TradingMarketState = {
  code: "EU" | "US";
  name: string;
  calendar: "XETR" | "NYSE";
  is_open: boolean;
  opens_at: string | null;
  closes_at: string | null;
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
  const learning = value.learning;
  const learningKeys = ["trend", "momentum", "volume", "breakout", "quality"];
  const learningWeights =
    isRecord(learning) && isRecord(learning.weights) ? learning.weights : null;
  const validLearning =
    isRecord(learning) &&
    learningWeights !== null &&
    learningKeys.every(
      (key) =>
        isFiniteNumber(learningWeights[key]) &&
        Number(learningWeights[key]) >= 0.25 &&
        Number(learningWeights[key]) <= 3,
    ) &&
    isFiniteNumber(learning.decision_threshold) &&
    isFiniteNumber(learning.base_threshold) &&
    Number.isInteger(learning.trades_learned) &&
    Number.isInteger(learning.wins) &&
    Number.isInteger(learning.losses) &&
    isFiniteNumber(learning.cumulative_reward_r) &&
    (learning.last_reward_r === null || isFiniteNumber(learning.last_reward_r)) &&
    Number.isInteger(learning.policy_version) &&
    typeof learning.updated_at === "string" &&
    Array.isArray(learning.recent_lessons) &&
    learning.recent_lessons.length <= 8 &&
    learning.recent_lessons.every(
      (lesson) =>
        isRecord(lesson) &&
        typeof lesson.ticker === "string" &&
        typeof lesson.lesson === "string" &&
        isFiniteNumber(lesson.reward_r) &&
        isFiniteNumber(lesson.realized_pnl) &&
        ["WIN", "LOSS", "FLAT"].includes(String(lesson.outcome)) &&
        Number.isInteger(lesson.policy_version) &&
        typeof lesson.created_at === "string",
    );
  return (
    Number.isInteger(value.id) &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    ["TREND", "BREAKOUT", "MOMENTUM", "HYBRID"].includes(String(value.strategy)) &&
    ["US", "EU"].includes(String(value.market)) &&
    ["USD", "EUR"].includes(String(value.currency)) &&
    ["STANDARD", "HIGH_VOLATILITY"].includes(String(value.risk_profile)) &&
    isFiniteNumber(value.risk_per_trade_percent) &&
    isFiniteNumber(value.max_portfolio_risk_percent) &&
    isFiniteNumber(value.initial_cash) &&
    isFiniteNumber(value.cash) &&
    isFiniteNumber(value.equity) &&
    isFiniteNumber(value.total_return_percent) &&
    isFiniteNumber(value.win_rate) &&
    isFiniteNumber(value.max_drawdown_percent) &&
    Array.isArray(value.open_positions) &&
    value.open_positions.length <= 50 &&
    Array.isArray(value.equity_curve) &&
    value.equity_curve.length <= 200 &&
    validLearning
  );
}

function isMarketState(value: unknown, code: "EU" | "US"): value is TradingMarketState {
  return (
    isRecord(value) &&
    value.code === code &&
    typeof value.name === "string" &&
    value.calendar === (code === "EU" ? "XETR" : "NYSE") &&
    typeof value.is_open === "boolean" &&
    (value.opens_at === null || typeof value.opens_at === "string") &&
    (value.closes_at === null || typeof value.closes_at === "string")
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
    isRecord(engine.markets) &&
    isMarketState(engine.markets.EU, "EU") &&
    isMarketState(engine.markets.US, "US") &&
    (engine.last_cycle === null ||
      (isRecord(engine.last_cycle) &&
        typeof engine.last_cycle.status === "string" &&
        typeof engine.last_cycle.started_at === "string")) &&
    Array.isArray(value.agents) &&
    value.agents.length === 8 &&
    value.agents.every(isAgent) &&
    Array.isArray(value.recent_news) &&
    value.recent_news.length <= 50
  );
}
