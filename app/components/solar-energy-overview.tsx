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

function ahValue(value: number | null | undefined) {
  const safeValue = finite(value);
  if (safeValue === null) return "N/A";
  return safeValue.toFixed(2);
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

const upsStateLabels = {
  charging: "Nabíjí se",
  discharging: "Vybíjí se",
  idle: "Klid / plně nabito",
  unknown: "Nedostupné",
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
      label="Solární proud"
      value={numberValue(telemetry?.solar_total_current, 2)}
      unit={finite(telemetry?.solar_total_current) === null ? undefined : "A"}
      detail="Solární vstup · ACS712 na A3"
      icon="solar"
      tone="solar"
      stale={stale}
    />
    <MetricCard
      label="Napětí baterie"
      value={numberValue(telemetry?.battery_voltage, 2)}
      unit={finite(telemetry?.battery_voltage) === null ? undefined : "V"}
      detail="INA219 · I²C 0x40"
      icon="battery"
      tone="positive"
      stale={stale}
    />
    <MetricCard
      label="Proud zátěže"
      value={signedValue(telemetry?.battery_flow_current_a, 2)}
      unit="A"
      detail="Zátěžová větev · převrácené znaménko A1"
      icon="current"
      tone="info"
      stale={stale}
    />
    <MetricCard label="Výkon zátěže" value={signedValue(telemetry?.battery_power_w, 1)} unit={finite(telemetry?.battery_power_w) === null ? undefined : "W"} detail="Napětí × proud zátěžové větve" icon="load" tone="warning" stale={stale} />
    <MetricCard label="Napětí zátěže" value={numberValue(telemetry?.load_voltage_v, 2)} unit={finite(telemetry?.load_voltage_v) === null ? undefined : "V"} detail="INA219 · I²C 0x45" icon="load" tone="info" stale={stale} />
    <MetricCard label="Proud baterie" value={signedValue(telemetry?.load_current_a, 2)} unit={finite(telemetry?.load_current_a) === null ? undefined : "A"} detail={batteryStateLabels[batteryState]} icon="current" tone={batteryState === "charging" ? "positive" : batteryState === "discharging" ? "warning" : "neutral"} stale={stale} />
    <MetricCard label="Výkon baterie" value={signedValue(telemetry?.load_power_w, 1)} unit={finite(telemetry?.load_power_w) === null ? undefined : "W"} detail="Kladný = nabíjení, záporný = vybíjení" icon="battery" tone={batteryState === "charging" ? "positive" : batteryState === "discharging" ? "warning" : "neutral"} stale={stale} />
    <MetricCard label="UPS Raspberry Pi" value={numberValue(telemetry?.ups_charge_percent, 0)} unit={finite(telemetry?.ups_charge_percent) === null ? undefined : "%"} detail={`${upsStateLabels[telemetry?.ups_state ?? "unknown"]} · ${numberValue(telemetry?.ups_voltage_v, 2)} V`} icon="battery" tone={telemetry?.ups_state === "charging" ? "positive" : telemetry?.ups_state === "discharging" ? "warning" : "neutral"} stale={stale} />
    <MetricCard label="Řídicí jednotka" value={systemLabel} detail={`CPU ${numberValue(telemetry?.rpi_cpu_temperature)} °C · ${formatAge(telemetry?.recorded_at, now)}`} icon="system" tone={freshness === "online" ? "positive" : freshness === "delayed" ? "warning" : "negative"} />
    <MetricCard label="Poslední data" value={formatTime(telemetry?.recorded_at)} detail={formatAge(telemetry?.recorded_at, now)} icon="clock" tone={freshness === "online" ? "info" : "negative"} />
     <MetricCard label="Teplota uvnitř" value={numberValue(telemetry?.object_temperature, 1)} unit={finite(telemetry?.object_temperature) === null ? undefined : "°C"} detail="DHT11 · uvnitř objektu" icon="temperature" tone="info" stale={stale} />
     <MetricCard label="Teplota venku" value={numberValue(telemetry?.outside_temperature, 1)} unit={finite(telemetry?.outside_temperature) === null ? undefined : "°C"} detail="Venkovní teplotní senzor" icon="temperature" tone="positive" stale={stale} />
   </section>;
}

function FlowArrow({ active, reverse = false }: { active: boolean; reverse?: boolean }) {
  return <div className={`solar-energy-arrow ${active ? "is-active" : ""} ${reverse ? "is-reverse" : ""}`} aria-hidden="true"><span /><b>→</b></div>;
}

export function EnergyFlow({ telemetry }: { telemetry: SolarEnergyPoint | null }) {
  const solar1Current = finite(telemetry?.solar_total_current);
  const loadCurrent = finite(telemetry?.load_current_a);
  const batteryCurrent = finite(telemetry?.battery_flow_current_a);
  return <SolarPanel title="Tok proudů a výkonů" eyebrow="Okamžité hodnoty" className="solar-energy-flow-panel">
    <div className="solar-energy-flow mt-5">
      <div className="solar-energy-node solar-energy-node--solar"><SolarIcon name="solar" className="h-7 w-7" /><span>Solární vstup</span><strong>{numberValue(solar1Current, 2)} {solar1Current === null ? "" : "A"}</strong><small>ACS712 · A3</small></div>
      <FlowArrow active={solar1Current !== null && solar1Current > 0.1} />
      <div className="solar-energy-node solar-energy-node--battery"><SolarIcon name="battery" className="h-7 w-7" /><span>Bateriová větev</span><strong>{signedValue(telemetry?.load_power_w, 1)} {finite(telemetry?.load_power_w) === null ? "" : "W"}</strong><small>{signedValue(loadCurrent, 2)} A · {batteryStateLabels[telemetry?.battery_state ?? "unknown"]}</small></div>
      <FlowArrow active={loadCurrent !== null && Math.abs(loadCurrent) > 0.1} />
      <div className="solar-energy-node solar-energy-node--solar"><SolarIcon name="load" className="h-7 w-7" /><span>Zátěž</span><strong>{signedValue(telemetry?.battery_power_w, 1)} {finite(telemetry?.battery_power_w) === null ? "" : "W"}</strong><small>{signedValue(batteryCurrent, 2)} A · zátěžová větev</small></div>
    </div>
    <p className="mt-4 text-xs leading-5 text-[var(--solar-muted)]">Podle požadovaného prohození hodnot se bateriová větev zobrazuje z A2, zátěžová větev z převráceného A1 a solární proud z A3.</p>
  </SolarPanel>;
}

export function BatteryStatus({ telemetry }: { telemetry: SolarEnergyPoint | null }) {
  const state = telemetry?.battery_state ?? "unknown";
  return <SolarPanel title={batteryStateLabels[state]} eyebrow="Baterie" className="h-full">
    <div className="mt-5 grid grid-cols-2 gap-3">
      <SensorValue label="Napětí" value={numberValue(telemetry?.battery_voltage, 2)} unit="V" />
      <SensorValue label="Proud zátěže" value={signedValue(telemetry?.battery_flow_current_a, 2)} unit="A" />
      <SensorValue label="Výkon baterie" value={signedValue(telemetry?.load_power_w, 1)} unit="W" />
      <SensorValue label="Solární vstup" value={numberValue(telemetry?.solar_total_current, 2)} unit="A" />
      <SensorValue label="Proud baterie" value={signedValue(telemetry?.load_current_a, 2)} unit="A" />
      <SensorValue label="Teplota" value={numberValue(telemetry?.battery_temperature, 1)} unit="°C" />
    </div>
    <div className="solar-battery-unknown mt-4"><span>Stav nabití</span><strong>N/A</strong><small>Vyžaduje data z BMS nebo kalibrovanou napěťovou křivku.</small></div>
  </SolarPanel>;
}

export function UpsStatus({ telemetry }: { telemetry: SolarEnergyPoint | null }) {
  const state = telemetry?.ups_state ?? "unknown";
  const percent = finite(telemetry?.ups_charge_percent);
  const tone = state === "charging" ? "text-emerald-700" : state === "discharging" ? "text-amber-700" : "text-[var(--solar-text)]";
  return <SolarPanel title="Záložní napájení Raspberry Pi" eyebrow="Waveshare UPS HAT · I²C 0x42">
    <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-[var(--solar-muted)]">Stav UPS</p><strong className={`mt-1 block text-2xl ${tone}`}>{upsStateLabels[state]}</strong></div>
      <div className="text-right"><p className="text-sm text-[var(--solar-muted)]">Zbývající kapacita</p><strong className="font-mono text-4xl text-[var(--solar-text)]">{numberValue(percent, 0)}{percent === null ? "" : " %"}</strong></div>
    </div>
    <div className="solar-ups-level mt-4" role="progressbar" aria-label="Nabití UPS" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === null ? undefined : Math.round(percent)}><span style={{ width: `${percent ?? 0}%` }} /></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <SensorValue label="Napětí packu" value={numberValue(telemetry?.ups_voltage_v, 3)} unit="V" />
      <SensorValue label="Proud" value={signedValue(telemetry?.ups_current_a, 3)} unit="A" />
      <SensorValue label="Kapacita" value={numberValue(telemetry?.ups_charge_percent, 1)} unit="%" />
    </div>
    <p className="mt-4 text-xs leading-5 text-[var(--solar-muted)]">Kladný proud znamená nabíjení, záporný vybíjení. Procenta jsou orientační odhad z napětí dvoučlánkového 18650 packu, nikoli údaj z coulomb counteru.</p>
  </SolarPanel>;
}

function SensorValue({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div className="solar-sensor-value"><span>{label}</span><strong>{value} <small>{value === "N/A" ? "" : unit}</small></strong></div>;
}

export function DailySummary({ summary }: { summary: SolarEnergySummary }) {
  const items = [
    ["Solární vstup dnes", ahValue(summary.solar1_ah), "Ah", "Integrál proudu ACS712 na A1"],
    ["Bateriová větev dnes", ahValue(summary.load_ah), "Ah", "Integrál proudu zobrazované bateriové větve"],
    ["Nabito do baterie", ahValue(summary.battery_charged_ah), "Ah", "Integrál kladného proudu baterie"],
    ["Odebráno z baterie", ahValue(summary.battery_discharged_ah), "Ah", "Integrál záporného proudu baterie"],
    ["Bilance baterie", signedValue(summary.battery_net_ah, 2), "Ah", "Nabito minus odebráno"],
    ["Energie do baterie", ahValue(summary.battery_charged_wh), "Wh", "Integrál kladného výkonu baterie"],
    ["Energie z baterie", ahValue(summary.battery_discharged_wh), "Wh", "Integrál záporného výkonu baterie"],
    ["Spotřeba dnes", ahValue(summary.consumption_energy_wh), "Wh", "Podle znaménka proudu baterie"],
    ["Maximum solárního vstupu", numberValue(summary.solar1_max_current_a, 2), "A", "Nejvyšší dnešní proud A1"],
    ["Maximum bateriové větve", numberValue(summary.load_max_current_a, 2), "A", "Nejvyšší dnešní zobrazovaný proud baterie"],
  ];
  return <SolarPanel id="souhrn" title="Dnešní souhrn" eyebrow="Europe/Prague">
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(([label, value, unit, detail]) => <div key={label} className="solar-summary-item"><span>{label}</span><strong>{value} <small>{value.includes("N/A") ? "" : unit}</small></strong><p>{detail}</p></div>)}
    </div>
    <p className="mt-4 text-xs text-[var(--solar-muted)]">Ah a Wh se počítají integrací naměřeného proudu a vypočteného výkonu v čase. Mezery delší než pět minut se nezapočítávají.</p>
  </SolarPanel>;
}

export function SensorGrid({ telemetry }: { telemetry: SolarEnergyPoint | null }) {
  const airQuality = getMq9AirQuality(telemetry?.mq9_raw);
  const sensors = [
    ["Teplota uvnitř", numberValue(telemetry?.object_temperature), "°C", "temperature"],
    ["Vlhkost uvnitř", numberValue(telemetry?.object_humidity), "%", "humidity"],
    ["Venkovní teplota", numberValue(telemetry?.outside_temperature), "°C", "temperature"],
    ["Venkovní vlhkost", numberValue(telemetry?.outside_humidity), "%", "humidity"],
    ["Venkovní tlak", numberValue(telemetry?.outside_pressure), "hPa", "pressure"],
    ["Teplota baterie", numberValue(telemetry?.battery_temperature), "°C", "temperature"],
    ["Teplota MPPT", numberValue(telemetry?.mppt_temperature), "°C", "temperature"],
    ["Vlhkost MPPT", numberValue(telemetry?.mppt_humidity), "%", "humidity"],
    ["Napětí zátěže", numberValue(telemetry?.load_voltage_v, 2), "V", "load"],
    ["MQ-9", numberValue(telemetry?.mq9_raw, 0), "RAW", "gas"],
    ["CPU Raspberry Pi", numberValue(telemetry?.rpi_cpu_temperature), "°C", "system"],
  ] as const;
  return <SolarPanel id="senzory" title="Detailní senzory" eyebrow="Poslední telemetrie">
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {sensors.map(([label, value, unit, icon]) => <article key={label} className="solar-sensor-card"><SolarIcon name={icon} className="h-5 w-5" /><div><span>{label}</span><strong>{value} <small>{value === "N/A" ? "" : unit}</small></strong>{label === "MQ-9" ? <p>Stav: {airQuality.label}</p> : null}</div></article>)}
    </div>
  </SolarPanel>;
}
