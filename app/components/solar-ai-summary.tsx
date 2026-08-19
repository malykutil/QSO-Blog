"use client";

import { useEffect, useState } from "react";

import type { SolarEnergyPoint, SolarEnergySummary, SolarRelayState } from "@/src/lib/solar-data";

type Forecast = { estimatedKwh: number | null; source: string | null };

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function temperatureTrend(history: SolarEnergyPoint[]) {
  const points = history
    .filter((item) => finite(item.object_temperature) !== null)
    .map((item) => ({ time: new Date(item.recorded_at).getTime(), temperature: item.object_temperature as number }))
    .sort((a, b) => a.time - b.time);
  if (points.length < 2) return null;
  const elapsedHours = (points.at(-1)!.time - points[0].time) / 3_600_000;
  return elapsedHours > 0 ? (points.at(-1)!.temperature - points[0].temperature) / elapsedHours : null;
}

function hourKey(recordedAt: string) {
  const date = new Date(recordedAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}`;
}

function hourLabel(key: string) {
  const date = new Date(`${key}:00:00`);
  return Number.isNaN(date.getTime()) ? key : date.toLocaleString("cs-CZ", { day: "2-digit", month: "2-digit", hour: "2-digit" });
}

function hourlyEnergy(history: SolarEnergyPoint[], selectedHour: string | null) {
  const points = history.filter((item) => selectedHour === null || hourKey(item.recorded_at) === selectedHour).sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  let loadWh = 0;
  let chargedWh = 0;
  let dischargedWh = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const elapsedMs = new Date(current.recorded_at).getTime() - new Date(previous.recorded_at).getTime();
    if (elapsedMs <= 0 || elapsedMs > 5 * 60 * 1000) continue;
    const hours = elapsedMs / 3_600_000;
    const previousBatteryCurrent = finite(previous.load_current_a);
    const currentBatteryCurrent = finite(current.load_current_a);
    const averageBatteryCurrent = previousBatteryCurrent !== null && currentBatteryCurrent !== null ? (previousBatteryCurrent + currentBatteryCurrent) / 2 : null;
    const batteryPrevious = finite(previous.load_power_w);
    const batteryCurrent = finite(current.load_power_w);
    if (averageBatteryCurrent !== null && averageBatteryCurrent > 0) {
      if (batteryPrevious !== null && batteryCurrent !== null) chargedWh += (Math.abs(batteryPrevious) + Math.abs(batteryCurrent)) / 2 * hours;
      const loadPrevious = finite(previous.battery_power_w);
      const loadCurrent = finite(current.battery_power_w);
      if (loadPrevious !== null && loadCurrent !== null) {
        const intervalLoadWh = (Math.abs(loadPrevious) + Math.abs(loadCurrent)) / 2 * hours;
        dischargedWh += intervalLoadWh;
        loadWh += intervalLoadWh;
      }
    } else if (averageBatteryCurrent !== null && averageBatteryCurrent < 0 && batteryPrevious !== null && batteryCurrent !== null) {
      const intervalBatteryWh = (Math.abs(batteryPrevious) + Math.abs(batteryCurrent)) / 2 * hours;
      dischargedWh += intervalBatteryWh;
      loadWh += intervalBatteryWh;
    }
  }
  return { loadWh, chargedWh, dischargedWh };
}

function kwh(value: number | null) { return value === null ? "—" : `${value.toFixed(2)} kWh`; }
function wh(value: number) { return `${value.toFixed(1)} Wh`; }

export function SolarAiSummary({ telemetry, history, summary, relays, forecast, offline, alarmActive }: {
  telemetry: SolarEnergyPoint | null;
  history: SolarEnergyPoint[];
  summary: SolarEnergySummary;
  relays: SolarRelayState;
  forecast: Forecast;
  offline: boolean;
  alarmActive: boolean;
}) {
  const temperature = finite(telemetry?.object_temperature);
  const batteryVoltage = finite(telemetry?.battery_voltage);
  const solarCurrent = finite(telemetry?.solar_total_current);
  const trend = temperatureTrend(history);
  const actualKwh = summary.battery_charged_wh / 1000;
  const hours = Array.from(new Set(history.map((item) => hourKey(item.recorded_at)))).sort();
  const [selectedHour, setSelectedHour] = useState<string | null>(hours.at(-1) ?? null);
  const [viewMode, setViewMode] = useState<"hour" | "24h">("hour");
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const effectiveSelectedHour = selectedHour !== null && hours.includes(selectedHour) ? selectedHour : hours.at(-1) ?? null;
  const selectedEnergy = hourlyEnergy(history, viewMode === "24h" ? null : effectiveSelectedHour);
  const selectedIndex = effectiveSelectedHour === null ? -1 : hours.indexOf(effectiveSelectedHour);
  const selectedLabel = viewMode === "24h" ? "24 hodin" : effectiveSelectedHour ? hourLabel(effectiveSelectedHour) : "Bez výběru";
  const elapsedSinceResetMinutes = Math.max(0, Math.floor((currentTime - new Date(new Date(currentTime).setMinutes(0, 0, 0)).getTime()) / 60_000));
  const status = alarmActive ? "Nouzový stav" : offline ? "Čekám na data" : batteryVoltage !== null && batteryVoltage < 11.8 ? "Nízké napětí" : "Systém pracuje";
  const tone = alarmActive || (batteryVoltage !== null && batteryVoltage < 11.8) ? "border-red-300 bg-red-50 dark:bg-red-950/30" : offline ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : "solar-panel";
  const recommendation = alarmActive
    ? "Zkontrolujte objekt; automatika drží relé vypnutá."
    : offline
      ? "Telemetrie je zastaralá, automatické rozhodování pozastavte."
      : temperature !== null && temperature < 22
        ? "Teplota je pod 22 °C, odtah má být vypnutý."
        : relays.fan12v
          ? "Odtah běží; vypne se až po poklesu teploty pod 22 °C."
          : trend !== null && trend > 0
            ? "Teplota roste, při dalším běhu se zapne odtah."
            : "Teplota nyní neroste a odtah je vypnutý.";

  return <section className={`rounded-[2rem] border p-5 md:p-7 ${tone}`} aria-labelledby="solar-ai-summary-title">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="solar-eyebrow">Automatické hodinové vyhodnocení</p><h2 id="solar-ai-summary-title" className="mt-1 text-2xl font-semibold text-[var(--solar-text)]">Jak si systém vede</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--solar-muted)]">Souhrn vychází z telemetrie, relé a předpovědi. Zařízení se řídí pevnými bezpečnostními pravidly.</p></div><span className="rounded-full border border-black/10 bg-white/70 px-3 py-1 text-sm font-semibold text-[var(--solar-text)] dark:bg-black/20">{status}</span></div>
    <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1" aria-label="Výběr hodiny">
      <button type="button" aria-label="Předchozí hodina" disabled={viewMode === "24h" || selectedIndex <= 0} onClick={() => setSelectedHour(hours[selectedIndex - 1] ?? effectiveSelectedHour)} className="shrink-0 rounded-full bg-white/70 px-3 py-1.5 text-sm font-bold text-[var(--solar-text)] disabled:cursor-not-allowed disabled:opacity-40">← −1h</button>
      <button type="button" aria-label="Následující hodina" disabled={viewMode === "24h" || selectedIndex < 0 || selectedIndex >= hours.length - 1} onClick={() => setSelectedHour(hours[selectedIndex + 1] ?? effectiveSelectedHour)} className="shrink-0 rounded-full bg-white/70 px-3 py-1.5 text-sm font-bold text-[var(--solar-text)] disabled:cursor-not-allowed disabled:opacity-40">+1h →</button>
      <button type="button" onClick={() => setViewMode("24h")} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold transition ${viewMode === "24h" ? "bg-slate-950 text-white" : "bg-white/70 text-[var(--solar-text)] hover:bg-white"}`}>24H</button>
      <span className="shrink-0 rounded-full bg-white/70 px-3 py-1.5 text-sm text-[var(--solar-text)]">{elapsedSinceResetMinutes} min od začátku měření</span>
      {effectiveSelectedHour ? <span className="shrink-0 rounded-full bg-white/70 px-3 py-1.5 text-sm font-semibold text-[var(--solar-text)]">{hourLabel(effectiveSelectedHour)}</span> : <span className="text-sm text-[var(--solar-muted)]">Hodinová data nejsou dostupná.</span>}
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="rounded-2xl bg-white/70 p-4 dark:bg-black/15"><p className="text-xs uppercase tracking-[0.16em] text-[var(--solar-muted)]">Teoreticky dnes</p><p className="mt-2 text-2xl font-semibold text-[var(--solar-text)]">{kwh(forecast.estimatedKwh)}</p><p className="mt-1 text-xs text-[var(--solar-muted)]">{forecast.source ? `Zdroj: ${forecast.source}` : "Předpověď není dostupná"}</p></div>
      <div className="rounded-2xl bg-white/70 p-4 dark:bg-black/15"><p className="text-xs uppercase tracking-[0.16em] text-[var(--solar-muted)]">Dnes nabito</p><p className="mt-2 text-2xl font-semibold text-[var(--solar-text)]">{kwh(actualKwh)}</p><p className="mt-1 text-xs text-[var(--solar-muted)]">Aktivní solární čas: {summary.active_charging_minutes} min</p></div>
      <div className="rounded-2xl bg-white/70 p-4 dark:bg-black/15"><p className="text-xs uppercase tracking-[0.16em] text-[var(--solar-muted)]">Spotřeba</p><p className="mt-2 text-2xl font-semibold text-[var(--solar-text)]">{wh(selectedEnergy.loadWh)}</p><p className="mt-1 text-xs text-[var(--solar-muted)]">{selectedLabel} · podle znaménka proudu baterie</p></div>
      <div className="rounded-2xl bg-white/70 p-4 dark:bg-black/15"><p className="text-xs uppercase tracking-[0.16em] text-[var(--solar-muted)]">Baterie</p><p className="mt-2 text-2xl font-semibold text-[var(--solar-text)]">{batteryVoltage === null ? "—" : `${batteryVoltage.toFixed(2)} V`}</p><p className="mt-1 text-xs text-[var(--solar-muted)]">Solární proud: {solarCurrent === null ? "—" : `${solarCurrent.toFixed(2)} A`}</p></div>
      <div className="rounded-2xl bg-white/70 p-4 dark:bg-black/15"><p className="text-xs uppercase tracking-[0.16em] text-[var(--solar-muted)]">Teplotní trend</p><p className="mt-2 text-2xl font-semibold text-[var(--solar-text)]">{trend === null ? "—" : `${trend >= 0 ? "+" : ""}${trend.toFixed(2)} °C/h`}</p><p className="mt-1 text-xs text-[var(--solar-muted)]">Uvnitř: {temperature === null ? "—" : `${temperature.toFixed(1)} °C`}</p></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-3 text-sm text-[var(--solar-text)]"><span className="rounded-full bg-white/70 px-3 py-1.5 dark:bg-black/15">Odtah 12 V: <strong>{relays.fan12v ? "zapnutý" : "vypnutý"}</strong></span><span className="rounded-full bg-white/70 px-3 py-1.5 dark:bg-black/15">Solární větev 1: <strong>{relays.solar1 ? "připojená" : "odpojená"}</strong></span><span className="rounded-full bg-white/70 px-3 py-1.5 dark:bg-black/15">Dnešních vzorků: <strong>{summary.unique_samples}</strong></span><span className="rounded-full bg-white/70 px-3 py-1.5 dark:bg-black/15">Spotřeba dnes: <strong>{wh(summary.consumption_energy_wh)}</strong></span><span className="rounded-full bg-white/70 px-3 py-1.5 dark:bg-black/15">Nabito dnes: <strong>{wh(summary.battery_charged_wh)}</strong></span><span className="rounded-full bg-white/70 px-3 py-1.5 dark:bg-black/15">Vybito dnes: <strong>{wh(summary.battery_discharged_wh)}</strong></span><span className="rounded-full bg-white/70 px-3 py-1.5 dark:bg-black/15">Nabití hodiny: <strong>{wh(selectedEnergy.chargedWh)}</strong></span><span className="rounded-full bg-white/70 px-3 py-1.5 dark:bg-black/15">Vybití hodiny: <strong>{wh(selectedEnergy.dischargedWh)}</strong></span></div>
    <p className="mt-4 rounded-2xl bg-white/60 p-4 text-sm font-medium leading-6 text-[var(--solar-text)] dark:bg-black/15"><strong>Doporučení:</strong> {recommendation}</p>
  </section>;
}
