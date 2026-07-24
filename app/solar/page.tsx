"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/app/components/app-shell";
import { defaultSolarRelayState, type SolarRelayName, type SolarRelayState, type SolarTelemetry } from "@/src/lib/solar-data";

const relayLabels: Record<SolarRelayName, string> = { solar1: "Relé Solár 1", solar2: "Relé Solár 2", battery: "Relé baterie", bufik: "Bufík", fan12v: "Ventilátor 12 V", fan24v: "Ventilátor 24 V" };
const currentLabels = [["solar1_current", "Solár 1"], ["solar2_current", "Solár 2"], ["battery_current", "Baterie"]] as const;
const temperatureLabels = [["object_temperature", "Objekt"], ["battery_temperature", "Baterie"], ["mppt_temperature", "MPPT"]] as const;
const currentSeries = [["solar1_current", "Solár 1", "#f59e0b"], ["solar2_current", "Solár 2", "#38bdf8"], ["battery_current", "Baterie", "#4ade80"]] as const;
const temperatureSeries = [["object_temperature", "Objekt", "#f97316"], ["battery_temperature", "Baterie", "#a855f7"], ["mppt_temperature", "MPPT", "#ef4444"]] as const;
const historyRanges = [["1h", "1 hodina"], ["24h", "24 hodin"], ["7d", "7 dní"], ["30d", "30 dní"]] as const;
type NumericTelemetryKey = Exclude<keyof SolarTelemetry, "recorded_at">;
type WeatherData = { location: { latitude: number; longitude: number; timezone: string }; panelWp: number; performanceRatio: number; panelOrientation: { tilt: number; azimuth: number; direction: string }; current: { temperature_2m?: number; weather_code?: number; cloud_cover?: number } | null; daily: { date: string; min: number | null; max: number | null; weatherCode: number | null; sunrise: string | null; sunset: string | null; estimatedKwh: number }[]; automation: { enabled: boolean; batteryHeatBelowC: number; cabinHeaterNightBelowC: number; relayMappingReady: boolean } };

function value(value: number | null | undefined, unit: string) { return typeof value === "number" ? `${value.toFixed(1)} ${unit}` : "—"; }
function weatherEmoji(code: number | null | undefined) { if (code === null || code === undefined) return "·"; if (code === 0) return "☀️"; if (code < 4) return "🌤️"; if (code < 50) return "☁️"; if (code < 70) return "🌧️"; if (code < 80) return "❄️"; return "⛈️"; }
function shortDate(date: string) { return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" }).format(new Date(`${date}T12:00:00`)); }

function HistoryChart({ history, series, title, unit }: { history: SolarTelemetry[]; series: readonly (readonly [NumericTelemetryKey, string, string])[]; title: string; unit: string }) {
  const width = 900;
  const height = 260;
  const values = series.flatMap(([key]) => history.map((item) => item[key] ?? 0));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);
  const pathFor = (key: NumericTelemetryKey) => history.map((item, index) => {
    const x = history.length > 1 ? (index / (history.length - 1)) * width : width / 2;
    const y = height - (((item[key] ?? 0) - min) / span) * (height - 24) - 12;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");

  return <div className="glass-panel rounded-[2rem] p-6 md:p-8"><div><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Historie</p><h2 className="mt-3 text-3xl font-semibold text-slate-950">{title}</h2></div>{history.length < 2 ? <p className="mt-6 rounded-[1.2rem] bg-slate-100 px-4 py-4 text-sm text-slate-600">Pro graf potřebuji alespoň dvě měření z Raspberry Pi.</p> : <><div className="mt-6 overflow-hidden rounded-[1.5rem] bg-slate-950 p-3"><svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={title}><g stroke="#29404c" strokeWidth="1"><path d={`M0 12H${width}`} /><path d={`M0 ${height / 2}H${width}`} /><path d={`M0 ${height - 12}H${width}`} /></g>{min < 0 ? <path d={`M0 ${height - ((0 - min) / span) * (height - 24) - 12}H${width}`} stroke="#94a3b8" strokeDasharray="5 5" /> : null}{series.map(([key, , color]) => <path key={String(key)} d={pathFor(key)} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}</svg></div><div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600">{series.map(([, label, color]) => <span key={label} className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{label}</span>)}<span className="text-slate-400">{unit}</span></div></>}</div>;
}

function SolarSystemGraphic({ relays }: { relays: SolarRelayState }) {
  return <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#071b20]/80 p-3 shadow-[0_25px_80px_rgba(5,33,35,0.3)]">
    <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-amber-300/20 blur-3xl" />
    <svg viewBox="0 0 760 360" role="img" aria-label="Schéma solárního systému" className="relative h-auto w-full">
      <defs>
        <linearGradient id="solar-sun" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#ffe49a" /><stop offset="1" stopColor="#f59e0b" /></linearGradient>
        <linearGradient id="solar-panel" x1="0" x2="1" y1="0" y2="1"><stop stopColor="#5bd5d2" /><stop offset="1" stopColor="#2563a8" /></linearGradient>
        <linearGradient id="solar-battery" x1="0" x2="1"><stop stopColor="#d9ffe7" /><stop offset="1" stopColor="#46c98a" /></linearGradient>
        <filter id="solar-glow"><feGaussianBlur stdDeviation="8" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <g opacity=".14" stroke="#d8fffb" strokeWidth="1"><path d="M20 60H740M20 120H740M20 180H740M20 240H740M20 300H740" /><path d="M80 20V340M160 20V340M240 20V340M320 20V340M400 20V340M480 20V340M560 20V340M640 20V340" /></g>
      <circle cx="108" cy="74" r="35" fill="url(#solar-sun)" filter="url(#solar-glow)" /><g stroke="#ffd979" strokeWidth="4" strokeLinecap="round"><path d="M108 18V4M108 144v-14M52 74H38M178 74h-14M68 34 58 24M148 124l-10-10M68 114l-10 10M148 24l-10 10" /></g>
      <g stroke="#f8c65c" strokeWidth="3" strokeDasharray="8 10" opacity=".8"><path d="M141 90 208 136" /><path d="M137 106 207 166" /></g>
      <g transform="translate(170 120)" stroke="#bffdfa" strokeWidth="2"><rect width="138" height="92" rx="12" fill="url(#solar-panel)" /><path d="M46 0v92M92 0v92M0 30h138M0 61h138" opacity=".65" /><path d="M30 92 12 124h114L108 92" fill="none" /></g>
      <g transform="translate(170 232)" stroke="#bffdfa" strokeWidth="2"><rect width="138" height="74" rx="12" fill="url(#solar-panel)" /><path d="M46 0v74M92 0v74M0 25h138M0 50h138" opacity=".65" /><path d="M30 74 12 106h114L108 74" fill="none" /></g>
      <path d="M310 166H356M310 270H356M356 166v104" stroke="#7df4cf" strokeWidth="4" strokeLinecap="round" />
      <g transform="translate(356 132)"><rect width="142" height="126" rx="18" fill="#102f35" stroke="#6ef0ce" strokeWidth="2" /><circle cx="28" cy="28" r="7" fill="#5eead4" /><text x="47" y="34" fill="#d8fffb" fontSize="16" fontWeight="700">MPPT</text><text x="24" y="64" fill="#8fc5c3" fontSize="12">REGULÁTOR</text><path d="M24 86h94" stroke="#2f6669" /><path d="M24 101h58" stroke="#2f6669" /><text x="24" y="118" fill="#65e6b8" fontSize="12">ONLINE</text></g>
      <path d="M498 195h52M498 195 550 90M498 195 550 300" stroke="#7df4cf" strokeWidth="4" strokeLinecap="round" />
      <g transform="translate(550 48)"><rect width="152" height="84" rx="16" fill="url(#solar-battery)" /><rect x="152" y="25" width="10" height="34" rx="4" fill="#b7f5d2" /><path d="M72 18v48M49 42h46" stroke="#17694e" strokeWidth="8" strokeLinecap="round" /><text x="18" y="76" fill="#17694e" fontSize="12" fontWeight="700">BATERIE</text></g>
      <g transform="translate(550 158)"><rect width="152" height="74" rx="16" fill="#17303a" stroke="#526f73" /><text x="18" y="28" fill="#d8fffb" fontSize="13" fontWeight="700">RELÉ / ZÁTĚŽ</text>{(["solar1", "solar2", "battery"] as SolarRelayName[]).map((relay, index) => <g key={relay}><circle cx={24 + index * 42} cy="52" r="7" fill={relays[relay] ? "#4ade80" : "#64748b"} /><text x={33 + index * 42} y="56" fill="#9cc6c7" fontSize="10">{index + 1}</text></g>)}</g>
      <g transform="translate(550 260)"><rect width="152" height="64" rx="16" fill="#17303a" stroke="#526f73" /><text x="18" y="26" fill="#d8fffb" fontSize="13" fontWeight="700">VÝSTUPY</text>{(["bufik", "fan12v", "fan24v"] as SolarRelayName[]).map((relay, index) => <circle key={relay} cx={30 + index * 45} cy="46" r="7" fill={relays[relay] ? "#4ade80" : "#64748b"} />)}</g>
      <text x="24" y="338" fill="#8bb8b8" fontSize="12" letterSpacing="2">OK2KZB  /  ŽIVÝ SYSTÉM</text>
    </svg>
  </div>;
}

export default function SolarPage() {
  const [telemetry, setTelemetry] = useState<SolarTelemetry | null>(null);
  const [history, setHistory] = useState<SolarTelemetry[]>([]);
  const [historyRange, setHistoryRange] = useState<(typeof historyRanges)[number][0]>("24h");
  const [relays, setRelays] = useState<SolarRelayState>(defaultSolarRelayState);
  const [canControl, setCanControl] = useState(false);
  const [status, setStatus] = useState("Čekám na data z Raspberry Pi…");
  const [busy, setBusy] = useState<SolarRelayName | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherStatus, setWeatherStatus] = useState("Načítám předpověď…");

  const load = useCallback(async () => {
    const response = await fetch(`/api/solar?range=${historyRange}`, { cache: "no-store" });
    if (!response.ok) { setStatus("Solární přehled není dostupný."); return; }
    const payload = await response.json();
    setTelemetry(payload.telemetry ?? null);
    setHistory(payload.history ?? []);
    setRelays({ ...defaultSolarRelayState, ...(payload.relays ?? {}) });
    setCanControl(Boolean(payload.canControl));
    setStatus(payload.telemetry ? `Poslední měření: ${new Date(payload.telemetry.recorded_at).toLocaleString("cs-CZ")}` : "Čekám na první měření z RPi…");
  }, [historyRange]);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 10000);
    return () => { window.clearTimeout(initialLoad); window.clearInterval(timer); };
  }, [load]);
  useEffect(() => {
    const loadWeather = async () => { try { const response = await fetch("/api/weather", { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error); setWeather(payload); setWeatherStatus("Předpověď aktualizována"); } catch { setWeatherStatus("Předpověď není dostupná"); } };
    void loadWeather();
    const timer = window.setInterval(() => void loadWeather(), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
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
    <section className="rounded-[2.4rem] bg-[linear-gradient(135deg,_#10251c,_#236342_52%,_#d58a35)] p-6 text-white shadow-[0_24px_80px_rgba(13,27,50,0.16)] md:p-8"><div className="grid items-center gap-7 xl:grid-cols-[.82fr_1.18fr]"><div><p className="text-xs uppercase tracking-[0.35em] text-emerald-100/80">Solární dohled</p><h1 className="mt-3 font-display text-5xl">Solární přehled</h1><p className="mt-4 text-lg leading-8 text-emerald-50/85">Živá data z Raspberry Pi a ovládání výkonových větví.</p><div className="mt-6 flex flex-wrap gap-2 text-xs uppercase tracking-[0.2em] text-emerald-100/75"><span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">2 panely</span><span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">MPPT</span><span className="rounded-full border border-white/15 bg-white/10 px-3 py-2">6 relé</span></div></div><SolarSystemGraphic relays={relays} /></div></section>
    <p className="rounded-[1.2rem] bg-white/75 px-5 py-4 text-sm text-slate-600">{status}</p>
    <section className="glass-panel rounded-[2rem] p-6 md:p-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Počasí a energie</p><h2 className="mt-3 text-3xl font-semibold text-slate-950">Předpověď pro stanici</h2><p className="mt-2 text-sm text-slate-500">49.4398092 N, 18.0245583 E · {weatherStatus}</p></div>{weather?.current ? <div className="rounded-[1.4rem] bg-amber-50 px-5 py-4 text-right"><p className="text-3xl">{weatherEmoji(weather.current.weather_code)}</p><p className="text-sm font-semibold text-amber-950">{value(weather.current.temperature_2m, "°C")}</p><p className="text-xs text-amber-900/70">mraky {value(weather.current.cloud_cover, "%")}</p></div> : null}</div>{weather ? <><div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600"><span className="rounded-full bg-emerald-100 px-3 py-2">2 × 250 Wp = {weather.panelWp} Wp</span><span className="rounded-full bg-sky-100 px-3 py-2">Orientace: {weather.panelOrientation.direction}</span><span className="rounded-full bg-slate-100 px-3 py-2">Sklon: {weather.panelOrientation.tilt}°</span></div><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">{weather.daily.map((day) => <div key={day.date} className="rounded-[1.4rem] bg-slate-100/80 p-4"><p className="text-xs font-semibold uppercase text-slate-500">{shortDate(day.date)}</p><p className="mt-2 text-2xl">{weatherEmoji(day.weatherCode)}</p><p className="mt-2 text-sm font-semibold text-slate-950">{value(day.max, "°C")} / {value(day.min, "°C")}</p><p className="mt-2 text-xs text-emerald-700">≈ {day.estimatedKwh.toFixed(2)} kWh</p></div>)}</div><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="rounded-[1.5rem] border border-emerald-200/70 bg-emerald-50 p-5"><p className="text-xs uppercase tracking-[0.25em] text-emerald-800/70">Odhad výroby dnes</p><p className="mt-2 text-3xl font-semibold text-emerald-950">≈ {weather.daily[0]?.estimatedKwh.toFixed(2) ?? "—"} kWh</p><p className="mt-2 text-sm text-emerald-900/70">Model podle záření na nakloněnou západní plochu, {weather.panelWp} Wp a koeficientu {Math.round(weather.performanceRatio * 100)} %.</p></div><div className="rounded-[1.5rem] border border-sky-200/70 bg-sky-50 p-5"><p className="text-xs uppercase tracking-[0.25em] text-sky-800/70">Připravené podmínky</p><p className="mt-2 text-sm leading-7 text-sky-950">Baterie pod {weather.automation.batteryHeatBelowC} °C před nabíjením → výhřev baterie.<br />Noční minimum pod {weather.automation.cabinHeaterNightBelowC} °C → bufík.</p><p className="mt-2 text-xs text-sky-900/60">Automatizace čeká na doplnění relé.</p></div></div></> : null}</section>
    <section className="grid gap-4 md:grid-cols-3">{currentLabels.map(([key, label]) => <div className="glass-panel rounded-[2rem] p-6" key={key}><p className="text-sm text-slate-500">Proud — {label}</p><p className="mt-3 text-4xl font-semibold text-slate-950">{value(telemetry?.[key], "A")}</p></div>)}</section>
    <section className="grid gap-4 md:grid-cols-3"><div className="glass-panel rounded-[2rem] p-6"><p className="text-sm text-slate-500">Baterie</p><p className="mt-3 text-3xl font-semibold text-slate-950">{value(telemetry?.battery_voltage, "V")}</p><p className="mt-2 text-sm text-slate-600">{value(telemetry?.battery_current, "A")} · {value(telemetry?.battery_voltage !== null && telemetry?.battery_voltage !== undefined && telemetry?.battery_current !== null && telemetry?.battery_current !== undefined ? telemetry.battery_voltage * telemetry.battery_current : null, "W")}</p></div><div className="glass-panel rounded-[2rem] p-6"><p className="text-sm text-slate-500">Napětí panelů</p><p className="mt-3 text-3xl font-semibold text-slate-950">{value(telemetry?.solar1_voltage, "V")}</p><p className="mt-2 text-sm text-slate-600">Solár 2: {value(telemetry?.solar2_voltage, "V")}</p></div><div className="glass-panel rounded-[2rem] p-6"><p className="text-sm text-slate-500">Dnešní energie</p><p className="mt-3 text-3xl font-semibold text-slate-950">{value(telemetry?.solar_energy_today_wh, "Wh")}</p><p className="mt-2 text-sm text-slate-600">Spotřeba: {value(telemetry?.load_energy_today_wh, "Wh")}</p></div></section>
    <section className="glass-panel rounded-[2rem] p-6 md:p-8"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Historická data</p><h2 className="mt-3 text-3xl font-semibold text-slate-950">Zvolené období</h2></div><div className="flex flex-wrap gap-2">{historyRanges.map(([range, label]) => <button key={range} type="button" onClick={() => setHistoryRange(range)} className={`rounded-full px-4 py-2 text-xs font-semibold transition ${historyRange === range ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{label}</button>)}</div></div></section>
    <HistoryChart history={history} series={currentSeries} title="Proudy — tam i zpět" unit="A" />
    <HistoryChart history={history} series={temperatureSeries} title="Teploty" unit="°C" />
    <section className="glass-panel rounded-[2rem] p-6 md:p-8"><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Teploty</p><h2 className="mt-3 text-3xl font-semibold text-slate-950">Stav systému</h2><div className="mt-6 grid gap-4 md:grid-cols-3">{temperatureLabels.map(([key, label]) => <div className="rounded-[1.5rem] bg-slate-100/80 p-5" key={key}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold text-slate-950">{value(telemetry?.[key], "°C")}</p></div>)}</div></section>
    <section className="glass-panel rounded-[2rem] p-6 md:p-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs uppercase tracking-[0.35em] text-slate-500">Ovládání</p><h2 className="mt-3 text-3xl font-semibold text-slate-950">Relé</h2></div><span className="rounded-full bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-900">{canControl ? "Ovládání povoleno" : "Pouze účet KZB"}</span></div>{!canControl ? <p className="mt-4 rounded-[1.2rem] bg-slate-100 px-4 py-3 text-sm text-slate-600">Stavy relé jsou viditelné. Pro jejich ovládání se přihlas účtem KZB.</p> : null}<div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{(Object.keys(relayLabels) as SolarRelayName[]).map((relay) => <button key={relay} type="button" onClick={() => void toggleRelay(relay)} disabled={!canControl || busy !== null} className={`rounded-[1.5rem] border p-5 text-left transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70 ${relays[relay] ? "border-emerald-700/30 bg-emerald-100" : "border-slate-900/10 bg-white/80"}`}><div className="flex items-center justify-between gap-3"><span className="font-semibold text-slate-950">{relayLabels[relay]}</span><span className={`h-3 w-3 rounded-full ${relays[relay] ? "bg-emerald-500" : "bg-slate-300"}`} /></div><p className="mt-2 text-sm text-slate-600">{busy === relay ? "Měním…" : relays[relay] ? "Zapnuto" : "Vypnuto"}</p></button>)}</div></section>
  </div></AppShell>;
}
