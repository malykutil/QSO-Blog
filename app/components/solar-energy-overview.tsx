import { getMq9AirQuality } from "@/src/lib/mq9-air-quality";
import type { SolarEnergyPoint, SolarEnergySummary, TelemetryFreshness } from "@/src/lib/solar-data";
import { MetricCard, SolarIcon, SolarPanel } from "@/app/components/solar-ui";

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberValue(value: number | null | undefined, digits = 1) {
  const safeValue = finite(value);
  return safeValue === null ? "N/A" : safeValue.toFixed(digits);
}

function signedValue(value: number | null | undefined, digits = 1) {
  const safeValue = finite(value);
  if (safeValue === null) return "N/A";
  return `${safeValue > 0 ? "+" : ""}${safeValue.toFixed(digits)}`;
}

function energyValue(value: number | null | undefined) {
  const safeValue = finite(value);
  if (safeValue === null) return "N/A";
  return (safeValue / 1000).toFixed(2);
}

function formatAge(recordedAt: string | null | undefined, now: number) {
  if (!recordedAt) return "bez přijatých dat";
  const seconds = Math.max(0, Math.round((now - new Date(recordedAt).getTime()) / 1000));
  if (seconds < 60) return `před ${seconds} s`;
  if (seconds < 3600) return `před ${Math.floor(seconds / 60)} min`;
  return `před ${Math.floor(seconds / 3600)} h`;
}

function formatTime(recordedAt: string | null | undefined) {
  if (!recordedAt) return "N/A";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(recordedAt));
}

const batteryStateLabels = {
  charging: "Nabíjení",
  discharging: "Vybíjení",
  idle: "Klid",
  unknown: "Neznámý stav",
} as const;

export function OverviewMetrics({
  telemetry,
  freshness,
  now,
}: {
  telemetry: SolarEnergyPoint | null;
  freshness: TelemetryFreshness;
  now: number;
}) {
  const stale = freshness !== "online";
  const batteryState = telemetry?.battery_state ?? "unknown";
  const systemLabel = freshness === "online" ? "Online" : freshness === "delayed" ? "Zpoždění" : "Offline";
  return <section className="solar-overview-grid" aria-label="Hlavní hodnoty systému">
    <MetricCard
      label="Solární výkon"
      value={numberValue(telemetry?.solar_total_power_w, 0)}
      unit={finite(telemetry?.solar_total_power_w) === null ? undefined : "W"}
      detail={finite(telemetry?.solar_total_power_w) === null ? `Výkon nelze určit · proud ${numberValue(telemetry?.solar_total_current)} A` : "Součet výkonu obou solárních větví"}
      icon="solar"
      tone="solar"
      stale={stale}
    />
    <MetricCard
      label="Aktuální spotřeba"
      value={numberValue(telemetry?.load_power, 0)}
      unit={finite(telemetry?.load_power) === null ? undefined : "W"}
      detail={finite(telemetry?.load_power) === null ? "Měření výkonu spotřeby zatím není dostupné" : "Okamžitý výkon spotřebičů"}
      icon="load"
      tone="info"
      stale={stale}
    />
    <MetricCard label="Napětí baterie" value={numberValue(telemetry?.battery_voltage, 2)} unit="V" detail="Měřeno senzorem INA219" icon="battery" tone="positive" stale={stale} />
    <MetricCard
      label="Proud baterie"
      value={signedValue(telemetry?.battery_current, 2)}
      unit="A"
      detail={batteryStateLabels[batteryState]}
      icon="current"
      tone={batteryState === "charging" ? "positive" : batteryState === "discharging" ? "warning" : "neutral"}
      stale={stale}
    />
    <MetricCard label="Stav baterie" value={batteryStateLabels[batteryState]} detail={`Výkon baterie ${signedValue(telemetry?.battery_power_w)} W`} icon="battery" tone={batteryState === "charging" ? "positive" : batteryState === "discharging" ? "warning" : "neutral"} stale={stale} />
    <MetricCard label="Nabití baterie" value="N/A" detail="Procento nelze bez napěťové křivky nebo BMS spolehlivě určit" icon="battery" stale={stale} />
    <MetricCard label="Řídicí jednotka" value={systemLabel} detail={`CPU ${numberValue(telemetry?.rpi_cpu_temperature)} °C · ${formatAge(telemetry?.recorded_at, now)}`} icon="system" tone={freshness === "online" ? "positive" : freshness === "delayed" ? "warning" : "negative"} />
    <MetricCard label="Poslední data" value={formatTime(telemetry?.recorded_at)} detail={formatAge(telemetry?.recorded_at, now)} icon="clock" tone={freshness === "online" ? "info" : "negative"} />
  </section>;
}

function FlowArrow({ active, reverse = false }: { active: boolean; reverse?: boolean }) {
  return <div className={`solar-energy-arrow ${active ? "is-active" : ""} ${reverse ? "is-reverse" : ""}`} aria-hidden="true"><span /><b>→</b></div>;
}

export function EnergyFlow({ telemetry }: { telemetry: SolarEnergyPoint | null }) {
  const solarPower = finite(telemetry?.solar_total_power_w);
  const loadPower = finite(telemetry?.load_power);
  const batteryPower = finite(telemetry?.battery_power_w);
  const charging = telemetry?.battery_state === "charging";
  const discharging = telemetry?.battery_state === "discharging";
  return <SolarPanel title="Tok energie" eyebrow="Aktuální směr" className="solar-energy-flow-panel">
    <div className="solar-energy-flow mt-5">
      <div className="solar-energy-node solar-energy-node--solar"><SolarIcon name="solar" className="h-7 w-7" /><span>Solární panely</span><strong>{numberValue(solarPower, 0)} {solarPower === null ? "" : "W"}</strong><small>{numberValue(telemetry?.solar_total_current)} A</small></div>
      <FlowArrow active={charging && solarPower !== null} />
      <div className="solar-energy-node solar-energy-node--battery"><SolarIcon name="battery" className="h-7 w-7" /><span>Baterie</span><strong>{signedValue(batteryPower, 0)} {batteryPower === null ? "" : "W"}</strong><small>{batteryStateLabels[telemetry?.battery_state ?? "unknown"]}</small></div>
      <FlowArrow active={discharging && loadPower !== null} reverse={charging} />
      <div className="solar-energy-node solar-energy-node--load"><SolarIcon name="load" className="h-7 w-7" /><span>Spotřeba objektu</span><strong>{numberValue(loadPower, 0)} {loadPower === null ? "" : "W"}</strong><small>{loadPower === null ? "Měření není dostupné" : "Aktuální odběr"}</small></div>
    </div>
    <p className="mt-4 text-xs leading-5 text-[var(--solar-muted)]">Animovaný směr se zobrazí pouze tam, kde jej lze potvrdit dostupným měřením. Chybějící výkon není odhadován z proudu.</p>
  </SolarPanel>;
}

export function BatteryStatus({ telemetry }: { telemetry: SolarEnergyPoint | null }) {
  const state = telemetry?.battery_state ?? "unknown";
  return <SolarPanel title={batteryStateLabels[state]} eyebrow="Baterie" className="h-full">
    <div className="mt-5 grid grid-cols-2 gap-3">
      <SensorValue label="Napětí" value={numberValue(telemetry?.battery_voltage, 2)} unit="V" />
      <SensorValue label="Proud" value={signedValue(telemetry?.battery_current, 2)} unit="A" />
      <SensorValue label="Výkon" value={signedValue(telemetry?.battery_power_w, 1)} unit="W" />
      <SensorValue label="Teplota" value={numberValue(telemetry?.battery_temperature, 1)} unit="°C" />
    </div>
    <div className="solar-battery-unknown mt-4"><span>Stav nabití</span><strong>N/A</strong><small>Vyžaduje data z BMS nebo kalibrovanou napěťovou křivku.</small></div>
  </SolarPanel>;
}

function SensorValue({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className="solar-sensor-value"><span>{label}</span><strong>{value} <small>{value === "N/A" ? "" : unit}</small></strong></div>;
}

export function DailySummary({ summary }: { summary: SolarEnergySummary }) {
  const energyBalance = finite(summary.produced_energy_wh) !== null && finite(summary.consumed_energy_wh) !== null
    ? (summary.produced_energy_wh as number) - (summary.consumed_energy_wh as number)
    : null;
  const items = [
    ["Vyrobená energie", energyValue(summary.produced_energy_wh), "kWh", "Vyžaduje měření výkonu panelů"],
    ["Spotřebovaná energie", energyValue(summary.consumed_energy_wh), "kWh", "Vyžaduje měření spotřeby"],
    ["Energetická bilance", energyValue(energyBalance), "kWh", "Výroba minus spotřeba"],
    ["Maximum panelů", numberValue(summary.solar_max_power_w, 0), "W", "Nejvyšší dnešní výkon"],
    ["Napětí baterie min / max", `${numberValue(summary.battery_voltage_min_v, 2)} / ${numberValue(summary.battery_voltage_max_v, 2)}`, "V", "Rozsah za dnešek"],
    ["Teplota uvnitř min / max", `${numberValue(summary.object_temperature_min_c, 1)} / ${numberValue(summary.object_temperature_max_c, 1)}`, "°C", "Rozsah za dnešek"],
  ];
  return <SolarPanel id="souhrn" title="Dnešní souhrn" eyebrow="Europe/Prague">
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value, unit, detail]) => <div key={label} className="solar-summary-item"><span>{label}</span><strong>{value} <small>{value.includes("N/A") ? "" : unit}</small></strong><p>{detail}</p></div>)}
    </div>
    <p className="mt-4 text-xs text-[var(--solar-muted)]">Tok do baterie dnes: {energyValue(summary.charged_energy_wh)} kWh · tok z baterie: {energyValue(summary.discharged_energy_wh)} kWh. Tyto hodnoty nejsou totéž co celková výroba a spotřeba objektu.</p>
  </SolarPanel>;
}

export function SensorGrid({ telemetry }: { telemetry: SolarEnergyPoint | null }) {
  const airQuality = getMq9AirQuality(telemetry?.mq9_raw);
  const sensors = [
    ["Teplota uvnitř", numberValue(telemetry?.object_temperature), "°C", "temperature"],
    ["Vlhkost uvnitř", numberValue(telemetry?.object_humidity), "%", "humidity"],
    ["Venkovní teplota", numberValue(telemetry?.outside_temperature), "°C", "temperature"],
    ["Venkovní tlak", numberValue(telemetry?.outside_pressure), "hPa", "pressure"],
    ["Teplota baterie", numberValue(telemetry?.battery_temperature), "°C", "temperature"],
    ["Teplota MPPT", numberValue(telemetry?.mppt_temperature), "°C", "temperature"],
    ["MQ-9", numberValue(telemetry?.mq9_raw, 0), "RAW", "gas"],
    ["CPU Raspberry Pi", numberValue(telemetry?.rpi_cpu_temperature), "°C", "system"],
  ] as const;
  return <SolarPanel id="senzory" title="Detailní senzory" eyebrow="Poslední telemetrie">
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {sensors.map(([label, value, unit, icon]) => <article key={label} className="solar-sensor-card"><SolarIcon name={icon} className="h-5 w-5" /><div><span>{label}</span><strong>{value} <small>{value === "N/A" ? "" : unit}</small></strong>{label === "MQ-9" ? <p>Stav: {airQuality.label}</p> : null}</div></article>)}
    </div>
  </SolarPanel>;
}
