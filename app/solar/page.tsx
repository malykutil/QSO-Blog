"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/app/components/app-shell";
import { defaultSolarRelayState, type SolarRelayName, type SolarRelayState, type SolarTelemetry } from "@/src/lib/solar-data";

const relayLabels: Record<SolarRelayName, string> = { solar1: "Relé Solár 1", solar2: "Relé Solár 2", battery: "Relé baterie", bufik: "Bufík", fan12v: "Ventilátor 12 V", fan24v: "Ventilátor 24 V" };
const currentLabels = [["solar1_current", "Solár 1"], ["solar2_current", "Solár 2"], ["battery_current", "Baterie"]] as const;
const temperatureLabels = [["object_temperature", "Objekt"], ["battery_temperature", "Baterie"], ["mppt_temperature", "MPPT"]] as const;

function value(value: number | null | undefined, unit: string) { return typeof value === "number" ? `${value.toFixed(1)} ${unit}` : "—"; }

export default function SolarPage() {
  const [telemetry, setTelemetry] = useState<SolarTelemetry | null>(null);
  const [relays, setRelays] = useState<SolarRelayState>(defaultSolarRelayState);
  const [status, setStatus] = useState("Čekám na data z Raspberry Pi…");
  const [busy, setBusy] = useState<SolarRelayName | null>(null);

  const load = async () => {
    const response = await fetch("/api/solar", { cache: "no-store" });
    if (!response.ok) { setStatus("Solární přehled není dostupný."); return; }
    const payload = await response.json();
    setTelemetry(payload.telemetry ?? null);
    setRelays({ ...defaultSolarRelayState, ...(payload.relays ?? {}) });
    setStatus(payload.telemetry ? `Poslední měření: ${new Date(payload.telemetry.recorded_at).toLocaleString("cs-CZ")}` : "Čekám na první měření z RPi…");
  };
  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 10000);
    return () => { window.clearTimeout(initialLoad); window.clearInterval(timer); };
  }, []);

  const toggleRelay = async (relay: SolarRelayName) => {
    setBusy(relay);
    const response = await fetch("/api/solar/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relay, isOn: !relays[relay] }) });
    const payload = await response.json().catch(() => null);
    setBusy(null);
    if (!response.ok) { setStatus(payload?.error ?? "Relé se nepodařilo přepnout."); return; }
    setRelays((current) => ({ ...current, [relay]: !current[relay] }));
    setStatus(`${relayLabels[relay]}: ${!relays[relay] ? "zapnuto" : "vypnuto"}.`);
  };

  return <AppShell><div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
    <section className="rounded-[2.4rem] bg-[linear-gradient(135deg,_#10251c,_#236342_52%,_#d58a35)] p-8 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)]"><p className="text-xs uppercase tracking-[0.35em] text-emerald-100/80">Solární dohled</p><h1 className="mt-3 font-display text-5xl">Solární přehled</h1><p className="mt-4 text-emerald-50/85">Živá data z Raspberry Pi a ovládání výkonových větví.</p></section>
    <p className="rounded-[1.2rem] bg-white/75 px-5 py-4 text-sm text-slate-600">{status}</p>
    <section className="grid gap-4 md:grid-cols-3">{currentLabels.map(([key, label]) => <div className="glass-panel rounded-[2rem] p-6" key={key}><p className="text-sm text-slate-500">Proud — {label}</p><p className="mt-3 text-4xl font-semibold text-slate-950">{value(telemetry?.[key], "A")}</p></div>)}</section>
    <section className="glass-panel rounded-[2rem] p-6 md:p-8"><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Teploty</p><h2 className="mt-3 text-3xl font-semibold text-slate-950">Stav systému</h2><div className="mt-6 grid gap-4 md:grid-cols-3">{temperatureLabels.map(([key, label]) => <div className="rounded-[1.5rem] bg-slate-100/80 p-5" key={key}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold text-slate-950">{value(telemetry?.[key], "°C")}</p></div>)}</div></section>
    <section className="glass-panel rounded-[2rem] p-6 md:p-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Ovládání</p><h2 className="mt-3 text-3xl font-semibold text-slate-950">Relé</h2></div><span className="rounded-full bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-900">Pouze účet KZB</span></div><div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{(Object.keys(relayLabels) as SolarRelayName[]).map((relay) => <button key={relay} type="button" onClick={() => void toggleRelay(relay)} disabled={busy !== null} className={`rounded-[1.5rem] border p-5 text-left transition hover:-translate-y-0.5 disabled:opacity-60 ${relays[relay] ? "border-emerald-700/30 bg-emerald-100" : "border-slate-900/10 bg-white/80"}`}><div className="flex items-center justify-between gap-3"><span className="font-semibold text-slate-950">{relayLabels[relay]}</span><span className={`h-3 w-3 rounded-full ${relays[relay] ? "bg-emerald-500" : "bg-slate-300"}`} /></div><p className="mt-2 text-sm text-slate-600">{busy === relay ? "Měním…" : relays[relay] ? "Zapnuto" : "Vypnuto"}</p></button>)}</div></section>
  </div></AppShell>;
}
