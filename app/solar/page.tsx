"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { AppShell } from "@/app/components/app-shell";
import { InteractiveHistoryChart } from "@/app/components/history-chart";
import {
  defaultSolarRelayState,
  type BatteryFlowState,
  type SolarEnergyPoint,
  type SolarEnergySummary,
  type SolarRelayName,
  type SolarRelayState,
  type TelemetryFreshness,
} from "@/src/lib/solar-data";
import {
  getTelemetryFreshness,
  SOLAR_MEASUREMENT_CONFIG,
} from "@/src/lib/solar-energy";
import { getMq9AirQuality, MQ9_CRITICAL_RAW } from "@/src/lib/mq9-air-quality";
import { readThemeMode, saveThemeMode } from "@/src/lib/theme";

const relayMeta: Record<SolarRelayName, { label: string; description: string; critical?: boolean }> = {
  solar1: { label: "Solar 1", description: "Vstup první solární větve" },
  solar2: { label: "Solar 2", description: "Vstup druhé solární větve" },
  battery: { label: "Bateriová větev", description: "Hlavní připojení baterie", critical: true },
  bufik: { label: "Bufík", description: "Topení objektu", critical: true },
  fan12v: { label: "Ventilátor 12 V", description: "Ventilace 12V větve" },
  fan24v: { label: "Ventilátor 24 V", description: "Ventilace 24V větve" },
};

const tabs = [
  ["overview", "Přehled"],
  ["energy", "Energie"],
  ["temperature", "Teploty"],
  ["control", "Ovládání"],
  ["system", "Systém"],
] as const;

type Tab = (typeof tabs)[number][0];
type HistoryRange = "1h" | "6h" | "24h" | "7d" | "30d";
const historyRanges: readonly HistoryRange[] = ["1h", "6h", "24h", "7d", "30d"];
type SolarPayload = {
  telemetry: SolarEnergyPoint | null;
  history: SolarEnergyPoint[];
  energySummary: SolarEnergySummary;
  relays: SolarRelayState;
  relayUpdatedAt: Partial<Record<SolarRelayName, string>>;
  canControl: boolean;
  alarmActive: boolean;
};

const emptySummary: SolarEnergySummary = {
  charged_energy_wh: 0,
  discharged_energy_wh: 0,
  energy_balance_wh: 0,
  solar1_max_current_a: null,
  solar2_max_current_a: null,
  solar_total_max_current_a: null,
  active_charging_minutes: 0,
  skipped_gaps: 0,
  unique_samples: 0,
};

const flowLabels: Record<BatteryFlowState, string> = {
  charging: "Nabíjení",
  discharging: "Vybíjení",
  idle: "Klidový stav",
  unknown: "Neznámý stav",
};

function formatValue(value: number | null | undefined, unit: string, digits = 1) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)} ${unit}` : "—";
}

function formatEnergy(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(2)} kWh` : `${value.toFixed(1)} Wh`;
}

function formatAge(recordedAt: string | null | undefined, now: number) {
  if (!recordedAt) return "bez měření";
  const seconds = Math.max(0, Math.round((now - new Date(recordedAt).getTime()) / 1000));
  if (seconds < 60) return `před ${seconds} s`;
  if (seconds < 3600) return `před ${Math.floor(seconds / 60)} min`;
  return `před ${Math.floor(seconds / 3600)} h`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function freshnessMeta(freshness: TelemetryFreshness) {
  if (freshness === "online") return { label: "Online", className: "solar-status solar-status--ok" };
  if (freshness === "delayed") return { label: "Zpožděná data", className: "solar-status solar-status--warning" };
  return { label: "Offline", className: "solar-status solar-status--danger" };
}

function Panel({
  title,
  eyebrow,
  children,
  className = "",
}: {
  title?: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`solar-panel ${className}`}>
      {eyebrow ? <p className="solar-eyebrow">{eyebrow}</p> : null}
      {title ? <h2 className="mt-1 text-xl font-semibold text-[var(--solar-text)]">{title}</h2> : null}
      {children}
    </section>
  );
}

function HistoryRangePicker({
  value,
  onChange,
  title,
}: {
  value: HistoryRange;
  onChange: (range: HistoryRange) => void;
  title: string;
}) {
  return (
    <Panel className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="solar-eyebrow">Časový rozsah</p>
        <h2 className="mt-1 text-xl font-semibold text-[var(--solar-text)]">{title}</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {historyRanges.map((range) => (
          <button
            key={range}
            type="button"
            onClick={() => onChange(range)}
            className={`solar-range ${value === range ? "is-active" : ""}`}
            aria-pressed={value === range}
          >
            {range}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "positive" | "warning" | "negative" | "info";
}) {
  return (
    <div className={`solar-metric solar-metric--${tone}`}>
      <p className="text-xs font-medium text-[var(--solar-muted)]">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-[var(--solar-text)]">{value}</p>
      {detail ? <p className="mt-1 text-xs leading-5 text-[var(--solar-muted)]">{detail}</p> : null}
    </div>
  );
}

function RelayControl({
  relay,
  isOn,
  updatedAt,
  disabled,
  busy,
  onToggle,
}: {
  relay: SolarRelayName;
  isOn: boolean;
  updatedAt?: string;
  disabled: boolean;
  busy: boolean;
  onToggle: (relay: SolarRelayName) => void;
}) {
  const meta = relayMeta[relay];
  const timerRef = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);

  const clearHold = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || busy) return;
    if (!meta.critical) {
      onToggle(relay);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setHolding(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setHolding(false);
      onToggle(relay);
    }, 1200);
  };

  return (
    <article className="solar-relay">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`solar-dot ${isOn ? "solar-dot--on" : ""}`} />
          <h3 className="font-semibold text-[var(--solar-text)]">{meta.label}</h3>
        </div>
        <p className="mt-1 text-sm text-[var(--solar-muted)]">{meta.description}</p>
        <p className="mt-2 text-xs text-[var(--solar-muted)]">
          {busy ? "Přepínání a ověřování…" : isOn ? "Zapnuto" : "Vypnuto"} · změna {formatDateTime(updatedAt)}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled || busy}
        onPointerDown={handlePointerDown}
        onPointerUp={clearHold}
        onPointerCancel={clearHold}
        onPointerLeave={clearHold}
        className={`solar-switch ${isOn ? "solar-switch--on" : ""} ${holding ? "solar-switch--holding" : ""}`}
        aria-label={`${meta.label}: ${isOn ? "vypnout" : "zapnout"}${meta.critical ? ", podržet 1,2 sekundy" : ""}`}
      >
        <span />
      </button>
      {meta.critical ? <p className="col-span-full text-xs text-[var(--solar-muted)]">Kritické relé: změnu potvrď podržením 1,2 s.</p> : null}
    </article>
  );
}

export default function SolarPage() {
  const [payload, setPayload] = useState<SolarPayload | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("24h");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyRelay, setBusyRelay] = useState<SolarRelayName | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/solar?range=${historyRange}`, { cache: "no-store" });
      if (!response.ok) throw new Error("solar-api");
      const nextPayload = (await response.json()) as SolarPayload;
      setPayload({
        ...nextPayload,
        relays: { ...defaultSolarRelayState, ...(nextPayload.relays ?? {}) },
        energySummary: nextPayload.energySummary ?? emptySummary,
      });
      setError(null);
    } catch {
      setError("Solární telemetrii se nepodařilo načíst. Zkontroluj připojení serveru.");
    } finally {
      setLoading(false);
    }
  }, [historyRange]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const refreshTimer = window.setInterval(() => void load(), 10_000);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [load]);

  const telemetry = payload?.telemetry ?? null;
  const history = payload?.history ?? [];
  const summary = payload?.energySummary ?? emptySummary;
  const freshness = getTelemetryFreshness(telemetry?.recorded_at, now);
  const status = freshnessMeta(freshness);
  const batteryState = telemetry?.battery_state ?? "unknown";
  const mq9AirQuality = getMq9AirQuality(telemetry?.mq9_raw);
  const fireAlarmActive = payload?.alarmActive ?? telemetry?.mq9_alarm ?? mq9AirQuality.label === "Kritická";
  const activeSolarInputs = [
    telemetry?.solar1_current !== null &&
    telemetry?.solar1_current !== undefined &&
    telemetry.solar1_current > SOLAR_MEASUREMENT_CONFIG.solarActiveCurrentThresholdA
      ? "Solar 1"
      : null,
    telemetry?.solar2_current !== null &&
    telemetry?.solar2_current !== undefined &&
    telemetry.solar2_current > SOLAR_MEASUREMENT_CONFIG.solarActiveCurrentThresholdA
      ? "Solar 2"
      : null,
  ].filter(Boolean);
  const activeRelays = useMemo(
    () => (Object.keys(payload?.relays ?? defaultSolarRelayState) as SolarRelayName[]).filter(
      (relay) => (payload?.relays ?? defaultSolarRelayState)[relay],
    ),
    [payload?.relays],
  );

  const toggleRelay = async (relay: SolarRelayName) => {
    if (!payload || busyRelay || freshness !== "online" || !payload.canControl || fireAlarmActive) return;
    const desiredState = !payload.relays[relay];
    if (relay === "battery" && !desiredState) {
      const confirmed = window.confirm(
        "Vypnutí bateriové větve může odpojit celý systém. Opravdu chceš pokračovat?",
      );
      if (!confirmed) return;
    }

    setBusyRelay(relay);
    setNotice(null);
    try {
      const command = await fetch("/api/solar/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relay, isOn: desiredState }),
      });
      if (!command.ok) throw new Error("command");
      const verification = await fetch(`/api/solar?range=${historyRange}`, { cache: "no-store" });
      if (!verification.ok) throw new Error("verification");
      const verifiedPayload = (await verification.json()) as SolarPayload;
      if (verifiedPayload.relays?.[relay] !== desiredState) throw new Error("state-mismatch");
      setPayload({
        ...verifiedPayload,
        relays: { ...defaultSolarRelayState, ...verifiedPayload.relays },
        energySummary: verifiedPayload.energySummary ?? emptySummary,
      });
      setNotice(`${relayMeta[relay].label}: potvrzeno ${desiredState ? "zapnuto" : "vypnuto"}.`);
    } catch {
      setNotice(`${relayMeta[relay].label}: změnu se nepodařilo bezpečně potvrdit.`);
    } finally {
      setBusyRelay(null);
    }
  };

  return (
    <AppShell compactMobile>
      <div className="solar-app mx-auto w-full max-w-[1400px]">
        <header className="solar-header">
          <div>
            <p className="solar-eyebrow">Off-grid chata · OK2KZB</p>
            <h1 className="mt-1 text-2xl font-semibold text-[var(--solar-text)] md:text-3xl">Energetický dohled</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={status.className}>{status.label}</span>
            <div className="text-right text-xs text-[var(--solar-muted)]">
              <p>{formatDateTime(telemetry?.recorded_at)}</p>
              <p>{formatAge(telemetry?.recorded_at, now)}</p>
            </div>
            <button
              type="button"
              className="solar-theme-button"
              onClick={() => saveThemeMode(readThemeMode() === "dark" ? "light" : "dark")}
              aria-label="Přepnout světlý a tmavý režim"
            >
              Motiv
            </button>
          </div>
        </header>

        <nav className="solar-tabs" aria-label="Sekce solárního dohledu">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setActiveTab(id)} className={activeTab === id ? "is-active" : ""}>
              {label}
            </button>
          ))}
        </nav>

        {error ? <p className="solar-alert solar-alert--danger">{error}</p> : null}
        {notice ? <p className="solar-alert solar-alert--info">{notice}</p> : null}
        {fireAlarmActive ? (
          <section className="solar-fire-alarm" role="alert" aria-live="assertive">
            <div>
              <p className="solar-eyebrow">Nouzový stav</p>
              <h2>POPLACH — kritická koncentrace CO nebo hořlavých plynů</h2>
              <p>Všechna relé byla nouzově vypnuta. Nevstupuj do objektu, dokud nebude bezpečně zkontrolovaný.</p>
            </div>
            <strong>MQ-9 RAW {Math.round(telemetry?.mq9_alarm_trigger_raw ?? telemetry?.mq9_raw ?? 0)}</strong>
          </section>
        ) : null}
        {loading && !payload ? <div className="solar-skeleton h-52" aria-label="Načítám telemetrii" /> : null}

        {!loading || payload ? (
          <main className="mt-4">
            {activeTab === "overview" ? (
              <div className="grid gap-4">
                <div className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
                  <Panel eyebrow="Tok energie" title="Solar 1 a Solar 2 → regulátory → baterie → spotřebiče">
                    <div className="solar-flow mt-5">
                      <div>
                        <span>Solar 1</span>
                        <strong>{formatValue(telemetry?.solar1_current, "A")}</strong>
                      </div>
                      <b>→</b>
                      <div>
                        <span>Solar 2</span>
                        <strong>{formatValue(telemetry?.solar2_current, "A")}</strong>
                      </div>
                      <b>→</b>
                      <div>
                        <span>Regulátory</span>
                        <strong>{formatValue(telemetry?.solar_total_current, "A")}</strong>
                      </div>
                      <b className={batteryState === "charging" ? "is-flowing" : ""}>→</b>
                      <div>
                        <span>Baterie</span>
                        <strong>{formatValue(telemetry?.battery_voltage, "V")}</strong>
                        <small>{formatValue(telemetry?.battery_power_w, "W")}</small>
                      </div>
                      <b className={batteryState === "discharging" ? "is-flowing" : ""}>→</b>
                      <div>
                        <span>Spotřebiče</span>
                        <strong>{batteryState === "discharging" ? "Odběr" : "—"}</strong>
                      </div>
                    </div>
                    <p className="mt-4 text-xs leading-5 text-[var(--solar-muted)]">
                      Výkon baterie je čistý tok do nebo z baterie. Není to hrubý výkon panelů ani přesná celková spotřeba.
                    </p>
                  </Panel>

                  <Panel eyebrow="Stav baterie" title={flowLabels[batteryState]}>
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <Metric label="Napětí" value={formatValue(telemetry?.battery_voltage, "V")} />
                      <Metric label="Proud" value={formatValue(telemetry?.battery_current, "A")} />
                      <Metric
                        label={
                          batteryState === "charging"
                            ? "Nabíjecí výkon"
                            : batteryState === "discharging"
                              ? "Vybíjecí výkon"
                              : "Výkon baterie"
                        }
                        value={formatValue(telemetry?.battery_power_w, "W")}
                        tone={batteryState === "charging" ? "positive" : batteryState === "discharging" ? "negative" : "neutral"}
                      />
                      <Metric label="Tolerance klidu" value={`±${SOLAR_MEASUREMENT_CONFIG.idleCurrentToleranceA.toFixed(1)} A`} />
                    </div>
                  </Panel>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <Panel eyebrow="Solární vstupy" title="Aktuální proudy">
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <Metric
                        label="Solar 1"
                        value={formatValue(telemetry?.solar1_current, "A")}
                        detail={`${activeSolarInputs.includes("Solar 1") ? "Dodává proud" : "Neaktivní"} · max dnes ${formatValue(summary.solar1_max_current_a, "A")}`}
                        tone={activeSolarInputs.includes("Solar 1") ? "positive" : "neutral"}
                      />
                      <Metric
                        label="Solar 2"
                        value={formatValue(telemetry?.solar2_current, "A")}
                        detail={`${activeSolarInputs.includes("Solar 2") ? "Dodává proud" : "Neaktivní"} · max dnes ${formatValue(summary.solar2_max_current_a, "A")}`}
                        tone={activeSolarInputs.includes("Solar 2") ? "positive" : "neutral"}
                      />
                      <Metric label="Celkem" value={formatValue(telemetry?.solar_total_current, "A")} tone="info" />
                      <Metric
                        label="Dnes maximum"
                        value={formatValue(summary.solar_total_max_current_a, "A")}
                        detail={`${summary.active_charging_minutes} min aktivní`}
                      />
                    </div>
                  </Panel>

                  <Panel eyebrow="Dnešní energie" title="Bilance baterie">
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <Metric label="Nabito" value={formatEnergy(summary.charged_energy_wh)} tone="positive" />
                      <Metric label="Vybito" value={formatEnergy(summary.discharged_energy_wh)} tone="negative" />
                      <div className="col-span-2">
                        <Metric
                          label="Čistá bilance"
                          value={formatEnergy(summary.energy_balance_wh)}
                          tone={summary.energy_balance_wh > 0 ? "positive" : summary.energy_balance_wh < 0 ? "negative" : "neutral"}
                        />
                      </div>
                    </div>
                  </Panel>

                  <Panel eyebrow="Aktivní zařízení" title={`${activeRelays.length} z 6 relé zapnuto`}>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {activeRelays.length ? activeRelays.map((relay) => (
                        <span key={relay} className="solar-chip solar-chip--active">{relayMeta[relay].label}</span>
                      )) : <span className="text-sm text-[var(--solar-muted)]">Žádné zařízení není zapnuté.</span>}
                    </div>
                    <button type="button" className="solar-link mt-5" onClick={() => setActiveTab("control")}>Otevřít ovládání</button>
                  </Panel>
                </div>
              </div>
            ) : null}

            {activeTab === "energy" ? (
              <div className="grid gap-4">
                <HistoryRangePicker value={historyRange} onChange={setHistoryRange} title="Energetická historie" />
                <InteractiveHistoryChart
                  history={history}
                  series={[
                    ["solar1_current", "Solar 1", "#d97706"],
                    ["solar2_current", "Solar 2", "#0284c7"],
                    ["solar_total_current", "Součet", "#16a34a"],
                  ]}
                  title="Solární proudy"
                  unit="A"
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  <InteractiveHistoryChart
                    history={history}
                    series={[["battery_voltage", "Napětí baterie", "#2563eb"]]}
                    title="Napětí baterie"
                    unit="V"
                  />
                  <InteractiveHistoryChart
                    history={history}
                    series={[["battery_current", "Proud baterie", "#7c3aed"]]}
                    title="Proud baterie"
                    unit="A"
                  />
                </div>
                <InteractiveHistoryChart
                  history={history}
                  series={[["battery_power_w", "Výkon baterie", "#dc2626"]]}
                  title="Výkon baterie — nad nulou nabíjení, pod nulou vybíjení"
                  unit="W"
                />
                <InteractiveHistoryChart
                  history={history}
                  series={[
                    ["energy_charged_wh", "Dodáno do baterie", "#16a34a"],
                    ["energy_discharged_wh", "Odebráno z baterie", "#dc2626"],
                    ["energy_balance_wh", "Čistá bilance", "#2563eb"],
                  ]}
                  title="Energetická bilance zvoleného období"
                  unit="Wh"
                />
              </div>
            ) : null}

            {activeTab === "temperature" ? (
              <div className="grid gap-4">
                <HistoryRangePicker value={historyRange} onChange={setHistoryRange} title="Historie teplot a kvality vzduchu" />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Teplota v chatě" value={formatValue(telemetry?.object_temperature, "°C")} />
                  <Metric label="Venkovní teplota" value={formatValue(telemetry?.outside_temperature, "°C")} />
                  <Metric label="Teplota baterie" value={formatValue(telemetry?.battery_temperature, "°C")} />
                  <Metric label="Teplota MPPT" value={formatValue(telemetry?.mppt_temperature, "°C")} />
                  <Metric label="Vlhkost v chatě" value={formatValue(telemetry?.object_humidity, "%")} />
                  <Metric label="Venkovní tlak" value={formatValue(telemetry?.outside_pressure, "hPa")} />
                  <Metric
                    label="Stav vzduchu (MQ-9)"
                    value={fireAlarmActive ? "POPLACH" : mq9AirQuality.label}
                    detail={mq9AirQuality.raw === null
                      ? "Senzor neposílá platná data."
                      : `Orientační stav CO a hořlavých plynů · RAW ${Math.round(mq9AirQuality.raw)}`}
                    tone={fireAlarmActive ? "negative" : mq9AirQuality.tone}
                  />
                </div>
                <InteractiveHistoryChart
                  history={history}
                  series={[
                    ["object_temperature", "Chata", "#ea580c"],
                    ["outside_temperature", "Venku", "#0284c7"],
                    ["battery_temperature", "Baterie", "#7c3aed"],
                    ["mppt_temperature", "MPPT", "#dc2626"],
                  ]}
                  title="Teploty"
                  unit="°C"
                />
                <InteractiveHistoryChart
                  history={history}
                  series={[["mq9_raw", "MQ-9", "#f97316"]]}
                  title="Koncentrace CO a hořlavých plynů (MQ-9)"
                  unit="RAW"
                  referenceLines={[[MQ9_CRITICAL_RAW + 1, "Hranice poplachu", "#dc2626"]]}
                />
              </div>
            ) : null}

            {activeTab === "control" ? (
              <div className="grid gap-4">
                <Panel eyebrow="Ruční režim" title="Ovládání relé">
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--solar-muted)]">
                    Nový stav se zobrazí až po potvrzení serverem. Ovládání je zablokováno při offline nebo zastaralé telemetrii.
                  </p>
                  {!payload?.canControl ? <p className="solar-alert solar-alert--warning mt-4">Pro ovládání se přihlas účtem KZB nebo administrátorským účtem.</p> : null}
                  {freshness !== "online" ? <p className="solar-alert solar-alert--warning mt-4">Relé nelze bezpečně ovládat, protože telemetrie není aktuální.</p> : null}
                  {fireAlarmActive ? <p className="solar-alert solar-alert--danger mt-4">Ovládání je zablokované aktivním MQ-9 poplachem.</p> : null}
                </Panel>
                <div className="grid gap-3 lg:grid-cols-2">
                  {(Object.keys(relayMeta) as SolarRelayName[]).map((relay) => (
                    <RelayControl
                      key={relay}
                      relay={relay}
                      isOn={payload?.relays[relay] ?? false}
                      updatedAt={payload?.relayUpdatedAt?.[relay]}
                      disabled={!payload?.canControl || freshness !== "online" || busyRelay !== null || fireAlarmActive}
                      busy={busyRelay === relay}
                      onToggle={(name) => void toggleRelay(name)}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {activeTab === "system" ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel eyebrow="Telemetrie" title="Stav dat">
                  <dl className="solar-definition-list mt-4">
                    <div><dt>Stav</dt><dd>{status.label}</dd></div>
                    <div><dt>Poslední kontakt</dt><dd>{formatDateTime(telemetry?.recorded_at)}</dd></div>
                    <div><dt>Stáří dat</dt><dd>{formatAge(telemetry?.recorded_at, now)}</dd></div>
                    <div><dt>Vzorky v rozsahu</dt><dd>{history.length}</dd></div>
                    <div><dt>Unikátní dnešní vzorky</dt><dd>{summary.unique_samples}</dd></div>
                    <div><dt>Vynechané dlouhé mezery</dt><dd>{summary.skipped_gaps}</dd></div>
                  </dl>
                </Panel>
                <Panel eyebrow="Konfigurace výpočtu" title="Kvalita energetických dat">
                  <dl className="solar-definition-list mt-4">
                    <div><dt>Tolerance klidu</dt><dd>±{SOLAR_MEASUREMENT_CONFIG.idleCurrentToleranceA} A</dd></div>
                    <div><dt>Max. integrační mezera</dt><dd>{SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs / 60_000} min</dd></div>
                    <div><dt>Online</dt><dd>do {SOLAR_MEASUREMENT_CONFIG.onlineAgeMs / 1000} s</dd></div>
                    <div><dt>Zpožděná data</dt><dd>do {SOLAR_MEASUREMENT_CONFIG.delayedAgeMs / 60_000} min</dd></div>
                  </dl>
                  <p className="mt-4 text-xs leading-5 text-[var(--solar-muted)]">
                    Solární napětí se neměří. Aplikace proto nezobrazuje ani neodhaduje výkon jednotlivých panelů.
                  </p>
                </Panel>
              </div>
            ) : null}
          </main>
        ) : null}
      </div>
    </AppShell>
  );
}
