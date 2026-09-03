"use client";

import { useEffect, useState } from "react";

type SolarDashboardPayload = {
  alarmActive?: boolean;
  telemetry: {
    battery_flow_current_a?: number | null;
    solar_total_current?: number | null;
    mq9_raw?: number | null;
    recorded_at: string;
  } | null;
  relays: Record<string, boolean>;
};

function value(numberValue: number | null | undefined, unit: string) {
  return typeof numberValue === "number" ? `${numberValue.toFixed(1)} ${unit}` : "—";
}

export function SolarDashboardCard() {
  const [payload, setPayload] = useState<SolarDashboardPayload | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/solar?range=1h", { cache: "no-store" });
        if (!response.ok) throw new Error("solar");
        const nextPayload = (await response.json()) as SolarDashboardPayload;
        if (!cancelled) {
          setPayload(nextPayload);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const telemetry = payload?.telemetry;
  const activeRelays = payload ? Object.values(payload.relays).filter(Boolean).length : 0;
  const isOnline = telemetry && now !== null
    ? now - new Date(telemetry.recorded_at).getTime() < 90000
    : false;

  return (
    <section className="glass-panel rounded-[2rem] p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Provozní přehled</p>
          <h2 className="mt-3 text-3xl font-semibold text-slate-950">Solární systém</h2>
        </div>
        <a href="/solar" className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
          Otevřít solární dohled
        </a>
      </div>
      {payload?.alarmActive ? (
        <div className="mt-5 rounded-2xl border-2 border-red-500 bg-red-950 px-5 py-4 text-white" role="alert">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-red-200">Nouzový stav</p>
          <p className="mt-2 text-xl font-bold">MQ-9 poplach — všechna relé vypnuta</p>
          <p className="mt-1 text-sm text-red-100">Kritická koncentrace CO nebo hořlavých plynů · RAW {Math.round(telemetry?.mq9_raw ?? 0)}</p>
        </div>
      ) : null}
      {error ? (
        <p className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Solární data nejsou momentálně dostupná.</p>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl bg-amber-50 p-4">
            <p className="text-sm text-amber-800/70">Solární proud</p>
            <p className="mt-2 text-2xl font-semibold text-amber-950">{value(telemetry?.solar_total_current, "A")}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-4">
            <p className="text-sm text-emerald-800/70">Proud zátěže</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-950">{value(telemetry?.battery_flow_current_a, "A")}</p>
            <p className="mt-1 text-xs text-emerald-900/70">Zátěžová větev · převrácené znaménko A1</p>
          </div>
          <div className="rounded-2xl bg-sky-50 p-4">
            <p className="text-sm text-sky-800/70">Relé</p>
            <p className="mt-2 text-2xl font-semibold text-sky-950">{activeRelays} aktivních</p>
          </div>
          <div className={`rounded-2xl p-4 ${isOnline ? "bg-emerald-50" : "bg-slate-100"}`}>
            <p className="text-sm text-slate-600">Spojení</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{isOnline ? "Online" : "—"}</p>
          </div>
        </div>
      )}
    </section>
  );
}
