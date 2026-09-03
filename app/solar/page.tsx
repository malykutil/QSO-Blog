"use client";

import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/app/components/app-shell";
import { DailySummary, BatteryStatus, EnergyFlow, OverviewMetrics, SensorGrid, UpsStatus } from "@/app/components/solar-energy-overview";
import { EventTimeline } from "@/app/components/solar-event-timeline";
import { SolarHistoryControls, type HistoryRange } from "@/app/components/solar-history-controls";
import { SolarAiSummary } from "@/app/components/solar-ai-summary";
import { SolarAutoManagerCard } from "@/app/components/solar-auto-manager-card";
import { SolarSecurityStatus } from "@/app/components/solar-security-status";
import { RelayCard, RelayConfirmationDialog } from "@/app/components/solar-relay-card";
import { AlertList, SolarPanel } from "@/app/components/solar-ui";
import { InteractiveHistoryChart } from "@/app/components/history-chart";
import { buildSolarAlerts, SOLAR_ALERT_THRESHOLDS, SOLAR_RELAY_META } from "@/src/lib/solar-dashboard";
import { getMq9AirQuality, MQ9_CRITICAL_RAW } from "@/src/lib/mq9-air-quality";
import {
  defaultSolarRelayState,
  type SolarEnergyPoint,
  type SolarEnergySummary,
  type SolarRelayName,
  type SolarRelayState,
} from "@/src/lib/solar-data";
import { getTelemetryFreshness, SOLAR_MEASUREMENT_CONFIG } from "@/src/lib/solar-energy";
import { readThemeMode, saveThemeMode } from "@/src/lib/theme";

type SolarPayload = {
  telemetry: SolarEnergyPoint | null;
  history: SolarEnergyPoint[];
  energySummary: SolarEnergySummary;
  relays: SolarRelayState;
  relayUpdatedAt: Partial<Record<SolarRelayName, string>>;
  relayModes: Partial<Record<SolarRelayName, "MANUAL_OFF" | "AUTO" | "MANUAL_ON">>;
  relayEvents: Array<{ id: number; occurredAt: string; label: string }>;
  canControl: boolean;
  alarmActive: boolean;
  alarmResetPending: boolean;
  relayCyclePending: boolean;
  security: { canRemoteControl: boolean; reasonCode: string | null; reason: string; telemetryFresh: boolean; controllerOnline: boolean; safetyControllerOk: boolean; emergencyStopClear: boolean; batteryPairConsistent: boolean; commandAuthenticationConfigured: boolean; localRemoteControlEnabled: boolean };
  commands?: Array<{ id: string; status: string; target: string; requested_state: boolean | null; reason_code: string | null; physically_verified: boolean }>;
};

type WeatherPayload = {
  forecastSource?: string;
  daily?: Array<{ date?: string; min?: number | null; max?: number | null; weatherCode?: number | null; estimatedKwh?: number | null; baseEstimatedKwh?: number | null }>;
  localWeather?: { summary?: string; adjustmentFactor?: number | null } | null;
};

const emptySummary: SolarEnergySummary = {
  solar1_max_current_a: null,
  solar2_max_current_a: null,
  solar_total_max_current_a: null,
  load_max_current_a: null,
  solar1_ah: 0,
  solar2_ah: 0,
  solar_total_ah: 0,
  load_ah: 0,
  battery_charged_ah: 0,
  battery_discharged_ah: 0,
  battery_net_ah: 0,
  battery_charged_wh: 0,
  battery_discharged_wh: 0,
  load_energy_wh: 0,
  consumption_energy_wh: 0,
  battery_max_charge_current_a: null,
  battery_max_discharge_current_a: null,
  battery_voltage_min_v: null,
  battery_voltage_max_v: null,
  object_temperature_min_c: null,
  object_temperature_max_c: null,
  active_charging_minutes: 0,
  skipped_gaps: 0,
  unique_samples: 0,
};

const historyRangeOrder: readonly HistoryRange[] = ["1h", "6h", "24h", "2d", "7d", "30d"];

function normalizePayload(payload: SolarPayload): SolarPayload {
  return {
    ...payload,
    history: payload.history ?? [],
    relays: { ...defaultSolarRelayState, ...(payload.relays ?? {}) },
    relayUpdatedAt: payload.relayUpdatedAt ?? {},
    relayEvents: payload.relayEvents ?? [],
    energySummary: payload.energySummary ?? emptySummary,
    alarmActive: Boolean(payload.alarmActive),
    alarmResetPending: Boolean(payload.alarmResetPending),
    canControl: Boolean(payload.canControl),
    relayCyclePending: Boolean(payload.relayCyclePending),
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "N/A";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatForecastDate(value: string | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${value}T12:00:00`));
}

function weatherCodeLabel(code: number | null | undefined) {
  if (code === 0) return "Jasno";
  if (code === 1 || code === 2) return "Částečně oblačno";
  if (code === 3) return "Zataženo";
  if (code === 45 || code === 48) return "Mlha";
  if (code !== null && code !== undefined && code >= 51 && code <= 67) return "Déšť";
  if (code !== null && code !== undefined && code >= 71 && code <= 77) return "Sníh";
  if (code !== null && code !== undefined && code >= 80 && code <= 82) return "Přeháňky";
  if (code !== null && code !== undefined && code >= 95) return "Bouřky";
  return "Počasí není dostupné";
}

export default function SolarPage() {
  const [payload, setPayload] = useState<SolarPayload | null>(null);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("24h");
  const [loadedHistoryRange, setLoadedHistoryRange] = useState<HistoryRange>("24h");
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyRelay, setBusyRelay] = useState<SolarRelayName | null>(null);
  const [relayErrors, setRelayErrors] = useState<Partial<Record<SolarRelayName, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{ relay: SolarRelayName; desiredState: boolean } | null>(null);
  const [alarmResetBusy, setAlarmResetBusy] = useState(false);
  const [alarmResetError, setAlarmResetError] = useState<string | null>(null);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [weather, setWeather] = useState<WeatherPayload | null>(null);

  useEffect(() => {
    fetch("/api/weather", { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<WeatherPayload> : null)
      .then((nextWeather) => setWeather(nextWeather))
      .catch(() => setWeather(null));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);

    const loadHistory = async () => {
      try {
        const response = await fetch(`/api/solar?range=${loadedHistoryRange}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("solar-history");
        const nextPayload = normalizePayload(await response.json() as SolarPayload);
        setPayload(nextPayload);
        setError(null);
      } catch (loadError) {
        if ((loadError as Error).name !== "AbortError") setError("Historická data se nepodařilo načíst. Aktuální telemetrii budeme dál obnovovat.");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setHistoryLoading(false);
        }
      }
    };
    void loadHistory();
    return () => controller.abort();
  }, [loadedHistoryRange]);

  useEffect(() => {
    let controller: AbortController | null = null;
    let cancelled = false;
    const loadLatest = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch("/api/solar?range=24h&latest=1", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("solar-latest");
        const latest = normalizePayload(await response.json() as SolarPayload);
        if (cancelled) return;
        setPayload((current) => ({ ...latest, history: current?.history ?? [] }));
        setError(null);
        setLoading(false);
      } catch (loadError) {
        if (!cancelled && (loadError as Error).name !== "AbortError") setError("Aktuální telemetrii se nepodařilo obnovit.");
      }
    };
    void loadLatest();
    const timer = window.setInterval(() => void loadLatest(), 10_000);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const telemetry = payload?.telemetry ?? null;
  // Zobrazené názvy odpovídají skutečnému zapojení: solární proud = ACS3,
  // proud baterie = ACS2 a proud zátěže = ACS1.
  // Zobrazené názvy odpovídají původnímu mapování instalace.
  const history = payload?.history ?? [];
  const requestOlderHistory = () => setLoadedHistoryRange((current) => {
    const currentIndex = historyRangeOrder.indexOf(current);
    return historyRangeOrder[Math.min(currentIndex + 1, historyRangeOrder.length - 1)];
  });
  const changeHistoryRange = (range: HistoryRange) => {
    setPayload((current) => current ? { ...current, history: [] } : current);
    setHistoryRange(range);
    setLoadedHistoryRange(range);
  };
  const chartHistoryProps = {
    history,
    canRequestOlderHistory: loadedHistoryRange !== historyRangeOrder[historyRangeOrder.length - 1],
    onRequestOlderHistory: requestOlderHistory,
  };
  const summary = payload?.energySummary ?? emptySummary;
  const freshness = getTelemetryFreshness(telemetry?.recorded_at, now);
  const mq9AirQuality = getMq9AirQuality(telemetry?.mq9_raw);
  const fireAlarmActive = payload?.alarmActive ?? telemetry?.mq9_alarm ?? mq9AirQuality.label === "Kritická";
  const relayErrorText = Object.values(relayErrors).filter(Boolean).join(" ");
  const alerts = useMemo(() => buildSolarAlerts({ telemetry, freshness, alarmActive: fireAlarmActive, relayError: relayErrorText }), [telemetry, freshness, fireAlarmActive, relayErrorText]);
  const activeRelays = (Object.keys(payload?.relays ?? defaultSolarRelayState) as SolarRelayName[]).filter((relay) => (payload?.relays ?? defaultSolarRelayState)[relay]);

  const executeRelayCommand = async (relay: SolarRelayName, desiredState: boolean) => {
    if (!payload || busyRelay || !payload.canControl || fireAlarmActive) return;
    setBusyRelay(relay);
    setNotice(null);
    setRelayErrors((current) => ({ ...current, [relay]: null }));
    try {
      const command = await fetch("/api/solar/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relay, isOn: desiredState }),
      });
      const result = await command.json() as { commandId?: string; reasonCode?: string; error?: string };
      if (!command.ok) throw new Error(result.error || result.reasonCode || "Příkaz byl odmítnut.");
      setNotice(`${SOLAR_RELAY_META[relay].label}: požadavek na ${desiredState ? "zapnutí" : "vypnutí"} byl uložen. Fyzický stav zařízení zatím nelze samostatně ověřit.`);
    } catch (commandError) {
      const message = `${SOLAR_RELAY_META[relay].label}: server nepotvrdil uložení požadovaného stavu.`;
      setRelayErrors((current) => ({ ...current, [relay]: commandError instanceof Error ? commandError.message : message }));
    } finally {
      setBusyRelay(null);
    }
  };

  const requestRelayCommand = (relay: SolarRelayName, desiredState: boolean) => {
    if (SOLAR_RELAY_META[relay].requiresConfirmation) {
      setPendingConfirmation({ relay, desiredState });
      return;
    }
    void executeRelayCommand(relay, desiredState);
  };

  const requestAlarmReset = async () => {
    if (!payload?.canControl || !fireAlarmActive || payload.alarmResetPending || alarmResetBusy) return;
    if (!window.confirm("Potvrď, že byl objekt fyzicky zkontrolován a nehrozí požár ani únik plynu. Všechna relé zůstanou vypnutá.")) return;
    setAlarmResetBusy(true);
    setAlarmResetError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/solar/alarm", { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Server vypnutí poplachu nepotvrdil.");
      setPayload((current) => current ? { ...current, alarmActive: true, alarmResetPending: true } : current);
      setNotice("Požadavek byl odeslán do RPi. Relé zůstávají vypnutá; stav se automaticky obnoví po potvrzení RPi.");
    } catch (resetError) {
      setAlarmResetError(resetError instanceof Error ? resetError.message : "Poplach se nepodařilo vypnout.");
    } finally {
      setAlarmResetBusy(false);
    }
  };

  const requestRelayCycle = async () => {
    if (!payload?.canControl || fireAlarmActive || cycleBusy || payload.relayCyclePending) return;
    if (!window.confirm("Spustit 30sekundový rychlý test relé? Budou postupně sepnuta pouze relé na GPIO 17, 4, 27, 22, 23 a 25. GPIO 24 a 18 se testu nezúčastní.")) return;
    setCycleBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/solar/cycle", { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Test relé se nepodařilo naplánovat.");
      setPayload((current) => current ? { ...current, relayCyclePending: true } : current);
      setNotice("Test relé byl naplánován. RPi postupně sepne šest bezpečných výstupů a po 30 sekundách je vypne.");
    } catch (cycleError) {
      setNotice(cycleError instanceof Error ? cycleError.message : "Test relé se nepodařilo naplánovat.");
    } finally {
      setCycleBusy(false);
    }
  };

  return <AppShell compactMobile>
    <div className="solar-app mx-auto w-full max-w-[1500px]">
      <header className="solar-header">
        <div><p className="solar-eyebrow">Off-grid dohled · OK2KZB</p><h1 className="mt-1 text-2xl font-semibold text-[var(--solar-text)] md:text-3xl">Solární a bezpečnostní dashboard</h1><p className="mt-2 text-sm text-[var(--solar-muted)]">Aktuální telemetrie, řízení zařízení a historie provozu na jednom místě.</p></div>
        <div className="flex flex-wrap items-center gap-3"><span className={`solar-status ${freshness === "online" ? "solar-status--ok" : freshness === "delayed" ? "solar-status--warning" : "solar-status--danger"}`}>{freshness === "online" ? "Online" : freshness === "delayed" ? "Zpožděná data" : "Offline"}</span><div className="text-right text-xs text-[var(--solar-muted)]"><p>Poslední data</p><p className="font-semibold text-[var(--solar-text)]">{formatDateTime(telemetry?.recorded_at)}</p></div><button type="button" className="solar-theme-button" onClick={() => saveThemeMode(readThemeMode() === "dark" ? "light" : "dark")} aria-label="Přepnout světlý a tmavý režim">Motiv</button></div>
      </header>

      <div className="mt-4"><AlertList alerts={alerts} /></div>
      {error ? <p className="solar-alert solar-alert--danger">{error}</p> : null}
      {notice ? <p className="solar-alert solar-alert--info">{notice}</p> : null}
      {payload?.security ? <div className="mt-4"><SolarSecurityStatus status={payload.security} /></div> : null}
      {payload ? <div className="mt-4"><SolarAutoManagerCard /></div> : null}
      {payload ? <div className="mt-4"><SolarAiSummary telemetry={telemetry} history={history} summary={summary} relays={payload.relays} forecast={{ estimatedKwh: weather?.daily?.[0]?.estimatedKwh ?? null, source: weather?.forecastSource ?? null, localSummary: weather?.localWeather?.summary ?? null, adjustmentFactor: weather?.localWeather?.adjustmentFactor ?? null }} offline={freshness === "offline"} alarmActive={fireAlarmActive} /></div> : null}
      {loading && !payload ? <div className="solar-skeleton h-56" aria-label="Načítám telemetrii" /> : <div className="mt-4"><OverviewMetrics telemetry={telemetry} freshness={freshness} now={now} /></div>}

      <nav className="solar-section-nav" aria-label="Sekce dashboardu">
        <a href="#tok">Proudy a výkony</a><a href="#zarizeni">Zařízení</a><a href="#souhrn">Dnešní souhrn</a><a href="#grafy">Grafy</a><a href="#senzory">Senzory</a><a href="#system">Systém</a>
      </nav>

      <main className="mt-4 grid gap-4">
        <section id="tok" className="grid scroll-mt-24 gap-4 xl:grid-cols-[1.35fr_.65fr]"><EnergyFlow telemetry={telemetry} /><BatteryStatus telemetry={telemetry} /></section>

        <UpsStatus telemetry={telemetry} />

        <SolarPanel id="zarizeni" title="Ovládání zařízení" eyebrow={`${activeRelays.length} z 8 požadavků zapnuto`}>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="max-w-3xl text-sm leading-6 text-[var(--solar-muted)]">Příkaz se zapíše pouze přes zabezpečené serverové API a UI následně ověří stav uložený v databázi. Samostatná fyzická zpětná vazba relé zatím není dostupná.</p>{!payload?.canControl ? <a href="/login" className="solar-link">Přihlásit pro ovládání</a> : null}</div>
          {freshness !== "online" ? <p className="solar-alert solar-alert--warning mt-4">Ovládání je zablokováno, protože telemetrie není aktuální.</p> : null}
          {fireAlarmActive ? <div className="solar-alert solar-alert--danger mt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong>Ovládání je zablokováno aktivním MQ-9 poplachem.</strong><p className="mt-1">Reset proveď až po fyzické kontrole objektu. Relé zůstanou vypnutá.</p></div>{payload?.canControl ? <button type="button" className="solar-alarm-reset" disabled={alarmResetBusy || payload.alarmResetPending || freshness !== "online"} onClick={() => void requestAlarmReset()}>{payload.alarmResetPending ? "Čekám na RPi…" : alarmResetBusy ? "Odesílám…" : "Potvrdit a vypnout poplach"}</button> : <a href="/login" className="solar-link">Přihlásit pro vypnutí</a>}</div>{alarmResetError ? <p className="mt-3 font-semibold">{alarmResetError}</p> : null}</div> : null}
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300/60 bg-amber-50/70 p-4 dark:bg-amber-950/20"><div className="min-w-0 flex-1"><p className="font-semibold text-[var(--solar-text)]">Rychlý test relé · 10 s</p><p className="mt-1 text-sm leading-5 text-[var(--solar-muted)]">Testuje pouze GPIO 17, 4, 27, 22, 23 a 25. Solární větve na GPIO 24 a 18 zůstávají nedotčené.</p></div><button type="button" className="solar-alarm-reset" disabled={!payload?.canControl || freshness !== "online" || fireAlarmActive || cycleBusy || Boolean(payload?.relayCyclePending)} onClick={() => void requestRelayCycle()}>{payload?.relayCyclePending ? "Test právě probíhá…" : cycleBusy ? "Odesílám…" : "Spustit test relé"}</button></div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{(Object.keys(defaultSolarRelayState) as SolarRelayName[]).map((relay) => <RelayCard key={relay} relay={relay} requestedState={payload?.relays[relay] ?? false} mode={payload?.relayModes[relay]} updatedAt={payload?.relayUpdatedAt[relay]} disabled={!payload?.canControl || busyRelay !== null || fireAlarmActive} busy={busyRelay === relay} error={relayErrors[relay]} onToggle={requestRelayCommand} />)}</div>
        </SolarPanel>

        <DailySummary summary={summary} />

        <section id="grafy" className="scroll-mt-24 grid gap-4">
          <SolarHistoryControls value={historyRange} loading={historyLoading} onChange={changeHistoryRange} />
          {historyLoading && !history.length ? <><div className="solar-skeleton h-72" /><div className="solar-skeleton h-72" /></> : <>
            <InteractiveHistoryChart {...chartHistoryProps} series={[["solar_total_current", "Solární vstup", "#f59e0b"], ["load_current_a", "Baterie", "#7c3aed"], ["battery_flow_current_a", "Zátěž", "#38bdf8"]]} title="Proudy všech měřených větví" unit="A" />
            <InteractiveHistoryChart {...chartHistoryProps} series={[["battery_power_w", "Výkon zátěže", "#7c3aed"], ["load_power_w", "Výkon baterie", "#ef4444"]]} title="Výkon do zátěže a do baterie" unit="W" />
            <InteractiveHistoryChart {...chartHistoryProps} series={[["solar1_ah", "Solární vstup", "#f59e0b"], ["load_ah", "Zátěž", "#38bdf8"], ["battery_charged_ah", "Nabito do baterie", "#7c3aed"], ["battery_discharged_ah", "Odebráno z baterie", "#ef4444"], ["battery_net_ah", "Zbývá (nabito − vybito)", "#16a34a"]]} title="Kumulované ampérhodiny ve zvoleném období" unit="Ah" />
            <div className="grid gap-4 xl:grid-cols-2"><InteractiveHistoryChart {...chartHistoryProps} series={[["battery_voltage", "Baterie", "#2563eb"], ["load_voltage_v", "Zátěž", "#dc2626"]]} title="Napětí baterie a zátěže" unit="V" /><InteractiveHistoryChart {...chartHistoryProps} series={[["load_current_a", "Baterie", "#7c3aed"], ["battery_flow_current_a", "Zátěž", "#38bdf8"]]} title="Proud baterie a zátěže" unit="A" /></div>
            <SolarPanel eyebrow="Baterie" title="Procento nabití"><p className="solar-alert solar-alert--info mt-4">Historie stavu nabití zatím není dostupná. Datový model nemá údaj z BMS ani kalibrované procento.</p></SolarPanel>
            <InteractiveHistoryChart {...chartHistoryProps} series={[["object_temperature", "Uvnitř", "#ea580c"], ["outside_temperature", "Venku", "#0284c7"], ["battery_temperature", "Baterie", "#7c3aed"], ["mppt_temperature", "MPPT", "#dc2626"]]} title="Teploty" unit="°C" />
            <div className="grid gap-4 xl:grid-cols-2"><InteractiveHistoryChart {...chartHistoryProps} series={[["object_humidity", "Uvnitř · D11", "#0891b2"], ["outside_humidity", "Venkovní · BME280", "#0284c7"], ["mppt_humidity", "MPPT · D12", "#7c3aed"]]} title="Vlhkost" unit="%" /><InteractiveHistoryChart {...chartHistoryProps} series={[["outside_pressure", "Venkovní tlak", "#64748b"]]} title="Atmosférický tlak" unit="hPa" /></div>
            <InteractiveHistoryChart {...chartHistoryProps} series={[["mq9_raw", "MQ-9", "#f97316"]]} title="CO a hořlavé plyny (MQ-9)" unit="RAW" referenceLines={[[MQ9_CRITICAL_RAW + 1, "Hranice poplachu", "#dc2626"]]} />
          </>}
        </section>

        {weather ? <section id="predpoved" className="scroll-mt-24"><SolarPanel title="Předpověď počasí" eyebrow="Internetová předpověď doplněná lokálními čidly">
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(weather.daily ?? []).slice(0, 4).map((day, index) => <div key={day.date ?? index} className={`rounded-2xl p-4 ${index === 0 ? "bg-sky-100/80 dark:bg-sky-950/30" : "bg-white/70 dark:bg-black/15"}`}>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--solar-muted)]">{index === 0 ? "Dnes" : formatForecastDate(day.date)}</p>
              <p className="mt-2 text-lg font-semibold text-[var(--solar-text)]">{weatherCodeLabel(day.weatherCode)}</p>
              <p className="mt-1 text-sm text-[var(--solar-muted)]">{day.min !== null && day.min !== undefined && day.max !== null && day.max !== undefined ? `${day.min.toFixed(0)}–${day.max.toFixed(0)} °C` : "Teplota není dostupná"}</p>
              <p className="mt-3 text-xl font-semibold text-[var(--solar-text)]">{day.estimatedKwh === null || day.estimatedKwh === undefined ? "—" : `${day.estimatedKwh.toFixed(2)} kWh`}</p>
              <p className="mt-1 text-xs text-[var(--solar-muted)]">odhad výroby</p>
            </div>)}
          </div>
          <div className="mt-4 rounded-2xl bg-white/60 p-4 text-sm leading-6 text-[var(--solar-muted)] dark:bg-black/15"><strong className="text-[var(--solar-text)]">Lokální korekce:</strong> {weather.localWeather?.summary ? `${weather.localWeather.summary}.` : "Čidla zatím nemají dostatek dat."} {weather.localWeather?.adjustmentFactor !== null && weather.localWeather?.adjustmentFactor !== undefined ? `Odhad výroby je upraven na ${Math.round(weather.localWeather.adjustmentFactor * 100)} % internetové předpovědi.` : ""} <span className="ml-1">Zdroj: {weather.forecastSource ?? "internetová předpověď"}.</span></div>
        </SolarPanel></section> : null}

        <SensorGrid telemetry={telemetry} />

        <section id="system" className="grid scroll-mt-24 gap-4 lg:grid-cols-2">
          <EventTimeline relays={payload?.relays ?? defaultSolarRelayState} updatedAt={payload?.relayUpdatedAt ?? {}} events={payload?.relayEvents ?? []} />
          <SolarPanel title="Stav dat a konfigurace" eyebrow="Systém"><dl className="solar-definition-list mt-4"><div><dt>Poslední kontakt</dt><dd>{formatDateTime(telemetry?.recorded_at)}</dd></div><div><dt>Vzorky v grafu</dt><dd>{history.length}</dd></div><div><dt>Dnešní unikátní vzorky</dt><dd>{summary.unique_samples}</dd></div><div><dt>Vynechané mezery</dt><dd>{summary.skipped_gaps}</dd></div><div><dt>Online limit</dt><dd>{SOLAR_MEASUREMENT_CONFIG.onlineAgeMs / 1000} s</dd></div><div><dt>Offline limit</dt><dd>{SOLAR_MEASUREMENT_CONFIG.delayedAgeMs / 60_000} min</dd></div><div><dt>Nízké napětí</dt><dd>{SOLAR_ALERT_THRESHOLDS.batteryLowVoltageV} V</dd></div><div><dt>MQ-9 poplach</dt><dd>RAW {MQ9_CRITICAL_RAW + 1}</dd></div></dl><p className="mt-4 text-xs leading-5 text-[var(--solar-muted)]">Historie se načítá pouze při změně časového rozsahu. Aktuální telemetrie a požadované stavy relé se obnovují samostatně každých 10 sekund.</p></SolarPanel>
        </section>
      </main>
    </div>

    {pendingConfirmation ? <RelayConfirmationDialog relay={pendingConfirmation.relay} desiredState={pendingConfirmation.desiredState} telemetry={telemetry} onCancel={() => setPendingConfirmation(null)} onConfirm={() => { const command = pendingConfirmation; setPendingConfirmation(null); void executeRelayCommand(command.relay, command.desiredState); }} /> : null}
  </AppShell>;
}
