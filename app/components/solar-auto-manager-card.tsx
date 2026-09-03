"use client";

import { useEffect, useState } from "react";

type AutoRelay = "bufik" | "fan12v" | "fan24v";
type RelayMode = "MANUAL_OFF" | "AUTO" | "MANUAL_ON";
type Status = { enabled: boolean; energy_state: string; energy_score: number; confidence: number; reason: string; battery?: { voltage: number | null; connected: boolean; relay_pair: { relay_1: boolean; relay_2: boolean; logical_state: string } }; solar?: { power: number }; load?: { power: number }; actions?: Partial<Record<AutoRelay, boolean>>; relay_modes?: Partial<Record<AutoRelay, RelayMode>>; last_decision: string | null };

const autoRelays: Array<{ relay: AutoRelay; label: string }> = [
  { relay: "bufik", label: "Topení" },
  { relay: "fan12v", label: "Ventilátor 12 V" },
  { relay: "fan24v", label: "Ventilátor 24 V" },
];

export function SolarAutoManagerCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyRelay, setBusyRelay] = useState<AutoRelay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => { const response = await fetch("/api/solar/auto/status", { cache: "no-store" }); if (response.ok) setStatus(await response.json() as Status); };
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(timer); }, []);
  const toggle = async () => { if (!status || busy) return; setBusy(true); setError(null); try { const response = await fetch("/api/solar/auto/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !status.enabled }) }); if (!response.ok) throw new Error("Globální AUTO režim se nepodařilo změnit."); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "AUTO se nepodařilo změnit."); } finally { setBusy(false); } };
  const setRelayMode = async (relay: AutoRelay, mode: RelayMode) => { if (busyRelay) return; setBusyRelay(relay); setError(null); try { const response = await fetch(`/api/solar/relay/${relay}/mode`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) }); if (!response.ok) throw new Error(`Režim relé ${relay} se nepodařilo změnit.`); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Režim relé se nepodařilo změnit."); } finally { setBusyRelay(null); } };
  if (!status) return <section className="solar-panel rounded-[2rem] p-5">AUTO Energy Manager načítá stav…</section>;
  const mismatch = status.battery?.relay_pair.logical_state === "BATTERY_RELAY_MISMATCH";
  return <section className="solar-panel rounded-[2rem] border p-5 md:p-7" aria-labelledby="auto-manager-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="solar-eyebrow">🤖 Lokální adaptivní řízení</p><h2 id="auto-manager-title" className="mt-1 text-2xl font-semibold text-[var(--solar-text)]">AUTO Energy Manager</h2></div><button type="button" onClick={() => void toggle()} disabled={busy} className={`rounded-full px-4 py-2 text-sm font-bold ${status.enabled ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-800"}`}>AUTO {status.enabled ? "ON" : "OFF"}</button></div>
    {mismatch ? <p className="mt-4 rounded-xl bg-red-100 px-4 py-3 text-sm font-bold text-red-900">⚠️ BATTERY_RELAY_MISMATCH — běžné AUTO řízení je pozastavené.</p> : null}
    {error ? <p className="mt-4 rounded-xl bg-red-100 px-4 py-3 text-sm font-bold text-red-900">{error}</p> : null}
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><div><p className="text-xs uppercase text-[var(--solar-muted)]">Energetický stav</p><p className="mt-1 text-xl font-semibold">{status.energy_state}</p></div><div><p className="text-xs uppercase text-[var(--solar-muted)]">Energy score</p><p className="mt-1 text-xl font-semibold">{status.energy_score} / 100</p></div><div><p className="text-xs uppercase text-[var(--solar-muted)]">Jistota modelu</p><p className="mt-1 text-xl font-semibold">{Math.round(status.confidence * 100)} %</p></div><div><p className="text-xs uppercase text-[var(--solar-muted)]">Baterie</p><p className="mt-1 text-xl font-semibold">{status.battery?.voltage == null ? "—" : `${status.battery.voltage.toFixed(2)} V`} · {status.battery?.relay_pair.logical_state ?? "UNKNOWN"}</p></div><div><p className="text-xs uppercase text-[var(--solar-muted)]">Bilance</p><p className="mt-1 text-xl font-semibold">{((status.solar?.power ?? 0) - (status.load?.power ?? 0)).toFixed(0)} W</p></div></div>
    <p className="mt-4 rounded-xl bg-white/60 p-3 text-sm text-[var(--solar-text)]">{status.reason}</p>
    <div className="mt-5 grid gap-3 md:grid-cols-3">
      {autoRelays.map(({ relay, label }) => { const mode = status.relay_modes?.[relay] ?? "MANUAL_OFF"; const isOn = status.actions?.[relay] === true; return <div key={relay} className="rounded-xl border border-slate-900/10 bg-white/60 p-4"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-[var(--solar-text)]">{label}</p><p className="mt-1 text-xs text-[var(--solar-muted)]">Controller: {isOn ? "ZAPNUTO" : "VYPNUTO"}</p></div><button type="button" disabled={busyRelay !== null} onClick={() => void setRelayMode(relay, mode === "AUTO" ? (isOn ? "MANUAL_ON" : "MANUAL_OFF") : "AUTO")} className={`rounded-full px-3 py-2 text-xs font-bold ${mode === "AUTO" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-800"}`}>{busyRelay === relay ? "UKLÁDÁM…" : mode === "AUTO" ? "AUTO" : "RUČNĚ"}</button></div><p className="mt-3 text-xs leading-5 text-[var(--solar-muted)]">{mode === "AUTO" ? status.enabled ? "Lokální controller smí relé řídit podle energie a teplot." : "Relé je připravené pro AUTO, globální AUTO je ale vypnuté." : "Relé zůstává v ručním režimu."}</p></div>; })}
    </div>
  </section>;
}
