import type {
  BatteryFlowState,
  SolarEnergyAnalysis,
  SolarEnergyPoint,
  SolarTelemetry,
  TelemetryFreshness,
} from "@/src/lib/solar-data";

export const SOLAR_MEASUREMENT_CONFIG = {
  idleCurrentToleranceA: 0.1,
  solarActiveCurrentThresholdA: 0.1,
  maxIntegrationGapMs: 5 * 60 * 1000,
  onlineAgeMs: 90 * 1000,
  delayedAgeMs: 5 * 60 * 1000,
} as const;

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function calculateBatteryPower(
  batteryVoltage: number | null | undefined,
  batteryCurrent: number | null | undefined,
) {
  const voltage = finite(batteryVoltage);
  const current = finite(batteryCurrent);
  return voltage === null || current === null ? null : voltage * current;
}

export function calculateSolarTotalCurrent(
  solar1Current: number | null | undefined,
  solar2Current: number | null | undefined,
) {
  const solar1 = finite(solar1Current);
  const solar2 = finite(solar2Current);
  if (solar1 === null && solar2 === null) return null;
  return (solar1 ?? 0) + (solar2 ?? 0);
}

export function getBatteryFlowState(
  batteryVoltage: number | null | undefined,
  batteryCurrent: number | null | undefined,
): BatteryFlowState {
  const voltage = finite(batteryVoltage);
  const current = finite(batteryCurrent);
  if (voltage === null || current === null) return "unknown";
  if (current > SOLAR_MEASUREMENT_CONFIG.idleCurrentToleranceA) return "charging";
  if (current < -SOLAR_MEASUREMENT_CONFIG.idleCurrentToleranceA) return "discharging";
  return "idle";
}

export function getTelemetryFreshness(recordedAt: string | null | undefined, now = Date.now()): TelemetryFreshness {
  if (!recordedAt) return "offline";
  const ageMs = now - new Date(recordedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > SOLAR_MEASUREMENT_CONFIG.delayedAgeMs) return "offline";
  if (ageMs > SOLAR_MEASUREMENT_CONFIG.onlineAgeMs) return "delayed";
  return "online";
}

export function enrichSolarTelemetry(sample: SolarTelemetry): SolarEnergyPoint {
  const solarTotalCurrent = calculateSolarTotalCurrent(sample.solar1_current, sample.solar2_current);
  const batteryPower = calculateBatteryPower(sample.battery_voltage, sample.battery_current);
  return {
    ...sample,
    solar_total_current: solarTotalCurrent,
    battery_power_w: batteryPower,
    battery_state: getBatteryFlowState(sample.battery_voltage, sample.battery_current),
    energy_charged_wh: 0,
    energy_discharged_wh: 0,
    energy_balance_wh: 0,
  };
}

export function analyzeSolarEnergy(samples: SolarTelemetry[]): SolarEnergyAnalysis {
  const uniqueByTimestamp = new Map<string, SolarTelemetry>();
  for (const sample of samples) {
    if (sample.recorded_at && !uniqueByTimestamp.has(sample.recorded_at)) {
      uniqueByTimestamp.set(sample.recorded_at, sample);
    }
  }

  const ordered = Array.from(uniqueByTimestamp.values()).sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  );
  const history = ordered.map(enrichSolarTelemetry);
  let chargedWh = 0;
  let dischargedWh = 0;
  let activeChargingMs = 0;
  let skippedGaps = 0;

  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    const elapsedMs = new Date(current.recorded_at).getTime() - new Date(previous.recorded_at).getTime();

    if (elapsedMs <= 0 || elapsedMs > SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs) {
      skippedGaps += elapsedMs > SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs ? 1 : 0;
      current.energy_charged_wh = chargedWh;
      current.energy_discharged_wh = dischargedWh;
      current.energy_balance_wh = chargedWh - dischargedWh;
      continue;
    }

    if (previous.battery_power_w !== null && current.battery_power_w !== null) {
      const averagePowerW = (previous.battery_power_w + current.battery_power_w) / 2;
      const intervalWh = averagePowerW * (elapsedMs / 3_600_000);
      if (intervalWh > 0) chargedWh += intervalWh;
      if (intervalWh < 0) dischargedWh += Math.abs(intervalWh);
    }

    const previousSolarActive =
      previous.solar_total_current !== null &&
      previous.solar_total_current > SOLAR_MEASUREMENT_CONFIG.solarActiveCurrentThresholdA;
    const currentSolarActive =
      current.solar_total_current !== null &&
      current.solar_total_current > SOLAR_MEASUREMENT_CONFIG.solarActiveCurrentThresholdA;
    if (previousSolarActive || currentSolarActive) activeChargingMs += elapsedMs;

    current.energy_charged_wh = chargedWh;
    current.energy_discharged_wh = dischargedWh;
    current.energy_balance_wh = chargedWh - dischargedWh;
  }

  const numeric = (key: "solar1_current" | "solar2_current" | "solar_total_current") =>
    history
      .map((sample) => sample[key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const solar1Values = numeric("solar1_current");
  const solar2Values = numeric("solar2_current");
  const solarTotalValues = numeric("solar_total_current");

  return {
    history,
    summary: {
      charged_energy_wh: chargedWh,
      discharged_energy_wh: dischargedWh,
      energy_balance_wh: chargedWh - dischargedWh,
      solar1_max_current_a: solar1Values.length ? Math.max(...solar1Values) : null,
      solar2_max_current_a: solar2Values.length ? Math.max(...solar2Values) : null,
      solar_total_max_current_a: solarTotalValues.length ? Math.max(...solarTotalValues) : null,
      active_charging_minutes: Math.round(activeChargingMs / 60_000),
      skipped_gaps: skippedGaps,
      unique_samples: history.length,
    },
  };
}
