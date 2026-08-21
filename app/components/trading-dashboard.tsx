"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isTradingDashboardPayload,
  type TradingAgent,
  type TradingDashboardPayload,
  type TradingMarketState,
} from "@/src/lib/trading-types";

const moneyFormatters = {
  USD: new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }),
  EUR: new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }),
};
function money(value: number, currency: "USD" | "EUR") {
  return moneyFormatters[currency].format(value);
}
const decimal = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 });
const accents = ["#22c55e", "#0ea5e9", "#f59e0b", "#8b5cf6"];
const localAssistantUrl = "http://127.0.0.1:8765";

type DashboardSource = "cloud" | "local";

async function fetchDashboard(url: string) {
  const isLocalRequest = url.startsWith(localAssistantUrl);
  const response = await fetch(url, {
    cache: "no-store",
    credentials: isLocalRequest ? "omit" : "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : "Trading přehled se nepodařilo načíst.";
    throw new Error(message);
  }
  if (!isTradingDashboardPayload(payload)) {
    throw new Error("Trading služba vrátila neplatná nebo neúplná data.");
  }
  return payload;
}

function cycleStatusLabel(status: string | undefined) {
  if (!status) return "čeká na první kontrolu";
  if (status === "SKIPPED_MARKET_CLOSED") return "americký trh je zavřený";
  if (status === "COMPLETED" || status === "SUCCESS") return "poslední kontrola proběhla úspěšně";
  if (status === "RUNNING") return "právě kontroluje trh";
  if (status === "FAILED") return "poslední kontrola skončila chybou";
  return status.toLocaleLowerCase("cs-CZ").replaceAll("_", " ");
}

function signedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${decimal.format(value)} %`;
}

function valueTone(value: number) {
  if (value > 0) return "text-emerald-600 dark:text-emerald-400";
  if (value < 0) return "text-rose-600 dark:text-rose-400";
  return "text-slate-500";
}

function marketDateTime(value: string | null) {
  if (!value) return "čas není dostupný";
  return new Date(value).toLocaleString("cs-CZ", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MarketSessionCard({ market }: { market: TradingMarketState }) {
  return (
    <article className="glass-panel rounded-[1.5rem] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Burzovní seance
          </p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">{market.name}</h2>
        </div>
        <span
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${
            market.is_open
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-900"
          }`}
        >
          {market.is_open ? "OTEVŘENO" : "ZAVŘENO"}
        </span>
      </div>
      <p className="mt-5 text-sm text-slate-500">
        {market.is_open ? "Dnešní zavření" : "Nejbližší otevření"}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-950">
        {marketDateTime(market.is_open ? market.closes_at : market.opens_at)}
      </p>
      <p className="mt-3 text-xs text-slate-500">
        Seance {marketDateTime(market.opens_at)}–{marketDateTime(market.closes_at)} · český čas
      </p>
    </article>
  );
}

function EquityChart({ agent }: { agent: TradingAgent }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(canvas.getBoundingClientRect().width, 320);
      const height = 250;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const points = agent.equity_curve.length
        ? agent.equity_curve.map((point) => point.equity)
        : [agent.initial_cash, agent.equity];
      const lowest = Math.min(...points) * 0.995;
      const highest = Math.max(...points) * 1.005;
      const span = Math.max(highest - lowest, 1);
      const padding = 18;

      context.strokeStyle = "rgba(100, 116, 139, 0.18)";
      context.lineWidth = 1;
      for (let index = 0; index < 5; index += 1) {
        const y = padding + ((height - padding * 2) * index) / 4;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }

      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#22c55e");
      gradient.addColorStop(1, "#0ea5e9");
      context.strokeStyle = gradient;
      context.lineWidth = 2.5;
      context.beginPath();
      points.forEach((point, index) => {
        const x = padding + ((width - padding * 2) * index) / Math.max(points.length - 1, 1);
        const y = height - padding - ((point - lowest) / span) * (height - padding * 2);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
    };

    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [agent]);

  return <canvas ref={canvasRef} className="mt-5 h-[250px] w-full" aria-label={`Vývoj equity agenta ${agent.name}`} />;
}

const learningLabels = {
  trend: "Trend",
  momentum: "Momentum",
  volume: "Relativní objem",
  breakout: "Průraz ceny",
  quality: "Kvalita trhu",
} as const;

function LearningPanel({ agent }: { agent: TradingAgent }) {
  const learning = agent.learning;
  const learnedWinRate = learning.trades_learned
    ? (learning.wins / learning.trades_learned) * 100
    : 0;

  return (
    <section className="glass-panel rounded-[1.8rem] p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Adaptivní model</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Jak se učí · {agent.name}</h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-violet-100 px-3 py-1.5 text-violet-800">
            Politika v{learning.policy_version}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">
            {learning.trades_learned} naučených obchodů
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-2xl bg-white/80 p-4">
              <p className="text-slate-500">Práh vstupu</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{decimal.format(learning.decision_threshold)}</p>
            </div>
            <div className="rounded-2xl bg-white/80 p-4">
              <p className="text-slate-500">Úspěšnost učení</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{decimal.format(learnedWinRate)} %</p>
            </div>
            <div className="rounded-2xl bg-white/80 p-4">
              <p className="text-slate-500">Výhry / ztráty</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{learning.wins} / {learning.losses}</p>
            </div>
            <div className="rounded-2xl bg-white/80 p-4">
              <p className="text-slate-500">Součet R</p>
              <p className={`mt-1 text-xl font-semibold ${valueTone(learning.cumulative_reward_r)}`}>
                {learning.cumulative_reward_r >= 0 ? "+" : ""}{decimal.format(learning.cumulative_reward_r)} R
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {Object.entries(learning.weights).map(([key, weight]) => (
              <div key={key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">{learningLabels[key as keyof typeof learningLabels]}</span>
                  <span className="font-semibold text-slate-950">{decimal.format(weight)}×</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-sky-500"
                    style={{ width: `${Math.min((weight / 3) * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-slate-950">Poslední lekce z uzavřených obchodů</h3>
          <div className="mt-3 space-y-3">
            {learning.recent_lessons.length ? learning.recent_lessons.map((lesson) => (
              <article key={`${lesson.policy_version}-${lesson.ticker}`} className="rounded-2xl border border-slate-900/8 bg-white/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-slate-950">{lesson.ticker} · v{lesson.policy_version}</strong>
                  <span className={`text-sm font-semibold ${valueTone(lesson.reward_r)}`}>
                    {lesson.reward_r >= 0 ? "+" : ""}{decimal.format(lesson.reward_r)} R · {money(lesson.realized_pnl, agent.currency)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{lesson.lesson}</p>
                <p className="mt-1 text-xs text-slate-400">{new Date(lesson.created_at).toLocaleString("cs-CZ")}</p>
              </article>
            )) : (
              <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center leading-6 text-slate-500">
                První lekce vznikne po uzavření PAPER obchodu. Do té doby agent používá bezpečný výchozí profil své strategie.
              </p>
            )}
          </div>
        </div>
      </div>
      <p className="mt-5 text-xs leading-5 text-slate-500">
        Váhy a práh se mění jen omezeně podle výsledku v R. Stop-loss, maximální riziko a PAPER-only režim se učením nemění.
      </p>
    </section>
  );
}

export function TradingDashboard() {
  const [data, setData] = useState<TradingDashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [capitalAgent, setCapitalAgent] = useState<TradingAgent | null>(null);
  const [capital, setCapital] = useState(10_000);
  const [resetHistory, setResetHistory] = useState(false);
  const [preserveHistory, setPreserveHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dataSource, setDataSource] = useState<DashboardSource | null>(null);

  const load = useCallback(async () => {
    try {
      let payload: TradingDashboardPayload;
      let source: DashboardSource = "cloud";
      try {
        payload = await fetchDashboard("/api/trading/dashboard");
      } catch {
        payload = await fetchDashboard(`${localAssistantUrl}/api/dashboard`);
        source = "local";
      }
      setData(payload);
      setDataSource(source);
      setError(null);
      setSelectedAgentId((current) => current ?? payload.agents[0]?.id ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? `${loadError.message} Zkontrolujte, že na tomto počítači běží AIStockPaperAssistant.`
          : "Trading přehled není dostupný.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const ranked = useMemo(
    () => [...(data?.agents ?? [])].sort((left, right) => right.total_return_percent - left.total_return_percent),
    [data],
  );
  const selectedAgent = ranked.find((agent) => agent.id === selectedAgentId) ?? ranked[0] ?? null;
  const usLeagueEquity = ranked
    .filter((agent) => agent.market === "US")
    .reduce((sum, agent) => sum + agent.equity, 0);
  const euLeagueEquity = ranked
    .filter((agent) => agent.market === "EU")
    .reduce((sum, agent) => sum + agent.equity, 0);
  const openPositions = ranked.reduce((sum, agent) => sum + agent.open_positions.length, 0);
  const lastCycle = data?.engine.last_cycle ?? null;

  const openCapital = (agent: TradingAgent) => {
    setCapitalAgent(agent);
    setCapital(agent.initial_cash);
    setResetHistory(Boolean(agent.open_positions.length || agent.closed_trades || agent.equity_curve.length));
    setPreserveHistory(false);
  };

  const saveCapital = async () => {
    if (!capitalAgent) return;
    setSaving(true);
    try {
      const capitalUrl = dataSource === "local"
        ? `${localAssistantUrl}/api/agents/${capitalAgent.id}/capital`
        : `/api/trading/agents/${capitalAgent.id}/capital`;
      const response = await fetch(capitalUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: dataSource === "local" ? "omit" : "same-origin",
        body: JSON.stringify({ capital, reset_history: resetHistory, preserve_history: preserveHistory }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; detail?: string } | null;
      if (!response.ok) throw new Error(payload?.error || payload?.detail || "Kapitál se nepodařilo uložit.");
      setCapitalAgent(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Kapitál se nepodařilo uložit.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[92rem] flex-col gap-6">
      <section className="overflow-hidden rounded-[2rem] border border-slate-900/10 bg-slate-950 p-7 text-white shadow-[0_28px_90px_rgba(15,23,42,0.22)] lg:p-9">
        <div className="flex flex-col justify-between gap-7 xl:flex-row xl:items-end">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_18px_#4ade80]" />
              PAPER ONLY · soukromý admin přehled
            </div>
            <h1 className="mt-4 font-display text-4xl leading-tight sm:text-6xl">AI Trading League</h1>
            <p className="mt-4 max-w-2xl leading-7 text-slate-300">
              Osm oddělených adaptivních strategií pro USA a EURO STOXX 50. Žádný účet nemůže zadat obchod se skutečnými penězi.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
              <p className="text-xs text-slate-400">Equity USA / Evropa</p>
              <p className="mt-2 text-lg font-semibold">{money(usLeagueEquity, "USD")}</p>
              <p className="text-lg font-semibold">{money(euLeagueEquity, "EUR")}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
              <p className="text-xs text-slate-400">Nejlepší agent</p>
              <p className="mt-2 text-2xl font-semibold">{ranked[0]?.name ?? "—"}</p>
            </div>
            <div className="col-span-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 sm:col-span-1">
              <p className="text-xs text-slate-400">Otevřené pozice</p>
              <p className="mt-2 text-2xl font-semibold">{openPositions}</p>
            </div>
          </div>
        </div>
      </section>

      {data ? (
        <div className="flex flex-col gap-2 rounded-[1.5rem] border border-emerald-300/50 bg-emerald-50 px-5 py-4 text-emerald-950 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Python PAPER engine je online · OHLCV data po 5 minutách</p>
            <p className="mt-1 text-sm text-emerald-800">
              {dataSource === "local" ? "Běží automaticky na tomto počítači" : "Běží v cloudu"} · USA max. 15 min · Evropa zpoždění cca 15–20 min · {cycleStatusLabel(lastCycle?.status)}
            </p>
          </div>
          <p className="text-sm text-emerald-800">
            {lastCycle?.finished_at ? `Poslední cyklus ${new Date(lastCycle.finished_at).toLocaleString("cs-CZ")}` : "Připraveno k prvnímu cyklu"}
          </p>
        </div>
      ) : null}

      {data ? (
        <section className="grid gap-4 md:grid-cols-2" aria-label="Otevírací doby sledovaných trhů">
          <MarketSessionCard market={data.engine.markets.EU} />
          <MarketSessionCard market={data.engine.markets.US} />
        </section>
      ) : null}

      {error ? (
        <div className="flex flex-col gap-3 rounded-[1.5rem] border border-rose-300/40 bg-rose-50 px-5 py-4 text-rose-950 sm:flex-row sm:items-center sm:justify-between">
          <p>{error}</p>
          <button type="button" onClick={() => void load()} className="rounded-xl bg-rose-950 px-4 py-2 text-sm font-semibold text-white">
            Zkusit znovu
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="glass-panel rounded-[2rem] p-10 text-center text-slate-600">Načítám zabezpečená PAPER data…</div>
      ) : null}

      {data ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            {ranked.map((agent, index) => (
              <article key={agent.id} className="glass-panel relative overflow-hidden rounded-[1.7rem] p-6">
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: accents[index % accents.length] }} />
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-bold tracking-[0.2em] text-slate-500">
                      {agent.market === "US" ? "USA" : "EVROPA"} · {agent.strategy}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-slate-950">{agent.name}</h2>
                  </div>
                  <span className="text-sm text-slate-500">#{index + 1}</span>
                </div>
                {agent.risk_profile === "HIGH_VOLATILITY" ? (
                  <p className="mt-4 inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800">
                    HIGH VOLATILITY · až {decimal.format(agent.risk_per_trade_percent)} % rizika / obchod
                  </p>
                ) : null}
                <p className="mt-4 inline-flex rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-800">
                  Učení v{agent.learning.policy_version} · {agent.learning.trades_learned} obchodů
                </p>
                <p className="mt-7 text-3xl font-semibold tracking-tight text-slate-950">{money(agent.equity, agent.currency)}</p>
                <p className={`mt-1 text-sm font-semibold ${valueTone(agent.total_return_percent)}`}>
                  {signedPercent(agent.total_return_percent)} od startu
                </p>
                <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
                  <div><dt className="text-slate-500">Hotovost</dt><dd className="mt-1 font-semibold text-slate-950">{money(agent.cash, agent.currency)}</dd></div>
                  <div><dt className="text-slate-500">Pozice</dt><dd className="mt-1 font-semibold text-slate-950">{agent.open_positions.length}</dd></div>
                  <div><dt className="text-slate-500">Win rate</dt><dd className="mt-1 font-semibold text-slate-950">{decimal.format(agent.win_rate)} %</dd></div>
                  <div><dt className="text-slate-500">Drawdown</dt><dd className="mt-1 font-semibold text-rose-600">{decimal.format(agent.max_drawdown_percent)} %</dd></div>
                  <div><dt className="text-slate-500">Max. otevřené riziko</dt><dd className="mt-1 font-semibold text-slate-950">{decimal.format(agent.max_portfolio_risk_percent)} %</dd></div>
                </dl>
                <div className="mt-6 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setSelectedAgentId(agent.id)} className="rounded-xl border border-slate-900/10 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-900">
                    Detail
                  </button>
                  <button type="button" onClick={() => openCapital(agent)} className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-semibold text-white">
                    Nastavit kapitál
                  </button>
                </div>
              </article>
            ))}
          </section>

          {selectedAgent ? (
            <>
              <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
                <div className="glass-panel rounded-[1.8rem] p-6">
                <div className="flex items-end justify-between gap-4">
                  <div><p className="text-xs uppercase tracking-[0.25em] text-slate-500">Výkonnost</p><h2 className="mt-2 text-2xl font-semibold text-slate-950">Equity · {selectedAgent.name}</h2></div>
                  <p className="text-sm text-slate-500">{selectedAgent.closed_trades} uzavřených obchodů</p>
                </div>
                <EquityChart agent={selectedAgent} />
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead className="text-xs uppercase tracking-wider text-slate-500"><tr><th className="py-3">#</th><th>Agent</th><th>Equity</th><th>Výnos</th><th>Win rate</th><th>Profit factor</th></tr></thead>
                    <tbody>
                      {ranked.map((agent, index) => (
                        <tr key={agent.id} className="border-t border-slate-900/8"><td className="py-4">#{index + 1}</td><td className="font-semibold">{agent.name}</td><td>{money(agent.equity, agent.currency)}</td><td className={valueTone(agent.total_return_percent)}>{signedPercent(agent.total_return_percent)}</td><td>{decimal.format(agent.win_rate)} %</td><td>{agent.profit_factor === null ? "—" : decimal.format(agent.profit_factor)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </div>

                <div className="glass-panel rounded-[1.8rem] p-6">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Portfolio</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">Pozice · {selectedAgent.name}</h2>
                <div className="mt-5 space-y-3">
                  {selectedAgent.open_positions.length ? selectedAgent.open_positions.map((position) => {
                    const pnl = (position.current_price - position.entry_price) * position.quantity;
                    return (
                      <article key={position.ticker} className="rounded-2xl border border-slate-900/8 bg-white/80 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <strong className="text-slate-950">{position.company_name}</strong>
                            <p className="mt-0.5 text-xs font-semibold tracking-[0.12em] text-slate-500">{position.ticker}</p>
                          </div>
                          <span className={`font-semibold ${valueTone(pnl)}`}>{pnl >= 0 ? "+" : ""}{money(pnl, selectedAgent.currency)}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{position.quantity} ks · vstup {decimal.format(position.entry_price)} · nyní {decimal.format(position.current_price)}</p>
                        <p className="text-sm leading-6 text-slate-600">SL {decimal.format(position.stop_loss)} · T1 {decimal.format(position.target_1)} · T2 {decimal.format(position.target_2)}</p>
                      </article>
                    );
                  }) : <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-slate-500">Agent zatím nemá otevřenou pozici.</p>}
                </div>
                </div>
              </section>
              <LearningPanel agent={selectedAgent} />
            </>
          ) : null}

          <section className="glass-panel rounded-[1.8rem] p-6">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div><p className="text-xs uppercase tracking-[0.25em] text-slate-500">Internetový dohled</p><h2 className="mt-2 text-2xl font-semibold text-slate-950">Poslední tržní zprávy</h2></div>
              <p className="text-sm text-slate-500">Aktualizace služby: {new Date(data.server_time).toLocaleString("cs-CZ")}</p>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {data.recent_news.length ? data.recent_news.map((article) => (
                <a key={article.fingerprint} href={article.url} target="_blank" rel="noopener noreferrer" className="rounded-2xl border border-slate-900/8 bg-white/80 p-4 transition hover:-translate-y-0.5 hover:bg-white">
                  <p className="font-semibold leading-6 text-slate-950">{article.title}</p>
                  <p className="mt-2 text-xs text-slate-500">{article.ticker || "TRH"} · {article.source} · skóre {article.significance_score}/10</p>
                </a>
              )) : <p className="text-slate-500">Zatím nebyly načtené žádné zprávy.</p>}
            </div>
          </section>
        </>
      ) : null}

      {capitalAgent ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="capital-title">
          <div className="w-full max-w-md rounded-[1.8rem] bg-white p-6 shadow-2xl dark:bg-slate-900">
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-600">Nastavení PAPER účtu</p>
            <h2 id="capital-title" className="mt-2 text-2xl font-semibold text-slate-950">Kapitál · {capitalAgent.name}</h2>
            <label className="mt-6 block text-sm font-semibold text-slate-700">Počáteční kapitál v {capitalAgent.currency}
              <input type="number" min={100} max={1_000_000_000} step={100} value={capital} onChange={(event) => setCapital(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3" />
            </label>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-slate-600">
              <input type="checkbox" checked={resetHistory} onChange={(event) => setResetHistory(event.target.checked)} className="mt-1" />
              Resetovat otevřené pozice, obchody, equity křivku i naučený profil. Tuto akci nelze vrátit.
            </label>
            <label className="mt-4 flex items-start gap-3 text-sm leading-6 text-slate-600">
              <input type="checkbox" checked={preserveHistory} onChange={(event) => setPreserveHistory(event.target.checked)} className="mt-1" />
              Navýšit PAPER kapitál a zachovat otevřené pozice, obchody i učení.
            </label>
            <div className="mt-7 flex justify-end gap-3">
              <button type="button" onClick={() => setCapitalAgent(null)} disabled={saving} className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700">Zrušit</button>
              <button type="button" onClick={() => void saveCapital()} disabled={saving || !Number.isFinite(capital)} className="rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? "Ukládám…" : "Uložit kapitál"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
