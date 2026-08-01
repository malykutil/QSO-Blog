import type {
  BatteryFlowState,
  SolarEnergyAnalysis,
  SolarEnergyPoint,
  SolarTelemetry,
  TelemetryFreshness,
  UpsFlowState,
} from "@/src/lib/solar-data";

export const SOLAR_MEASUREMENT_CONFIG = {
  idleCurrentToleranceA: 0.1,
  solarActiveCurrentThresholdA: 0.1,
  maxIntegrationGapMs: 5 * 60 * 1000,
  onlineAgeMs: 90 * 1000,
  delayedAgeMs: 5 * 60 * 1000,
  upsCurrentDeadbandA: 0.01,
} as const;

export function calculateUpsChargePercent(voltage: number | null | undefined) {
  const safeVoltage = finite(voltage);
  if (safeVoltage === null) return null;
  return Math.max(0, Math.min(100, ((safeVoltage - 6) / 2.4) * 100));
}

export function getUpsFlowState(current: number | null | undefined): UpsFlowState {
  const safeCurrent = finite(current);
  if (safeCurrent === null) return "unknown";
  if (safeCurrent > SOLAR_MEASUREMENT_CONFIG.upsCurrentDeadbandA) return "charging";
  if (safeCurrent < -SOLAR_MEASUREMENT_CONFIG.upsCurrentDeadbandA) return "discharging";
  return "idle";
}

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  // Legacy INA219 columns carry the dedicated Waveshare UPS HAT values from RPi.
  const upsVoltage = finite(sample.ina219_shunt_voltage_mv);
  const upsCurrent = finite(sample.ina219_current);
  return {
    ...sample,
    solar_total_current: solarTotalCurrent,
    battery_state: getBatteryFlowState(sample.battery_voltage, sample.battery_current),
    ups_voltage_v: upsVoltage,
    ups_current_a: upsCurrent,
    ups_charge_percent: calculateUpsChargePercent(upsVoltage),
    ups_state: getUpsFlowState(upsCurrent),
    solar1_ah: 0,
    solar2_ah: 0,
    solar_total_ah: 0,
    battery_charged_ah: 0,
    battery_discharged_ah: 0,
    battery_net_ah: 0,
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
  let activeChargingMs = 0;
  let skippedGaps = 0;
  let solar1Ah = 0;
  let solar2Ah = 0;
  let batteryChargedAh = 0;
  let batteryDischargedAh = 0;

  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    const elapsedMs = new Date(current.recorded_at).getTime() - new Date(previous.recorded_at).getTime();

    if (elapsedMs <= 0 || elapsedMs > SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs) {
      skippedGaps += elapsedMs > SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs ? 1 : 0;
      current.solar1_ah = solar1Ah;
      current.solar2_ah = solar2Ah;
      current.solar_total_ah = solar1Ah + solar2Ah;
      current.battery_charged_ah = batteryChargedAh;
      current.battery_discharged_ah = batteryDischargedAh;
      current.battery_net_ah = batteryChargedAh - batteryDischargedAh;
      continue;
    }

    const intervalHours = elapsedMs / 3_600_000;
    if (previous.solar1_current !== null && current.solar1_current !== null) {
      solar1Ah += Math.max(0, (previous.solar1_current + current.solar1_current) / 2) * intervalHours;
    }
    if (previous.solar2_current !== null && current.solar2_current !== null) {
      solar2Ah += Math.max(0, (previous.solar2_current + current.solar2_current) / 2) * intervalHours;
    }
    if (previous.battery_current !== null && current.battery_current !== null) {
      const intervalAh = ((previous.battery_current + current.battery_current) / 2) * intervalHours;
      if (intervalAh > 0) batteryChargedAh += intervalAh;
      if (intervalAh < 0) batteryDischargedAh += Math.abs(intervalAh);
    }

    const previousSolarActive =
      previous.solar_total_current !== null &&
      previous.solar_total_current > SOLAR_MEASUREMENT_CONFIG.solarActiveCurrentThresholdA;
    const currentSolarActive =
      current.solar_total_current !== null &&
      current.solar_total_current > SOLAR_MEASUREMENT_CONFIG.solarActiveCurrentThresholdA;
    if (previousSolarActive || currentSolarActive) activeChargingMs += elapsedMs;

    current.solar1_ah = solar1Ah;
    current.solar2_ah = solar2Ah;
    current.solar_total_ah = solar1Ah + solar2Ah;
    current.battery_charged_ah = batteryChargedAh;
    current.battery_discharged_ah = batteryDischargedAh;
    current.battery_net_ah = batteryChargedAh - batteryDischargedAh;
  }

  const numeric = (key: keyof SolarEnergyPoint) =>
    history
      .map((sample) => sample[key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const solar1Values = numeric("solar1_current");
  const solar2Values = numeric("solar2_current");
  const solarTotalValues = numeric("solar_total_current");
  const batteryCurrentValues = numeric("battery_current");
  const batteryVoltageValues = numeric("battery_voltage");
  const objectTemperatureValues = numeric("object_temperature");

  return {
    history,
    summary: {
      solar1_max_current_a: solar1Values.length ? Math.max(...solar1Values) : null,
      solar2_max_current_a: solar2Values.length ? Math.max(...solar2Values) : null,
      solar_total_max_current_a: solarTotalValues.length ? Math.max(...solarTotalValues) : null,
      solar1_ah: solar1Ah,
      solar2_ah: solar2Ah,
      solar_total_ah: solar1Ah + solar2Ah,
      battery_charged_ah: batteryChargedAh,
      battery_discharged_ah: batteryDischargedAh,
      battery_net_ah: batteryChargedAh - batteryDischargedAh,
      battery_max_charge_current_a: batteryCurrentValues.some((value) => value > 0) ? Math.max(...batteryCurrentValues.filter((value) => value > 0)) : null,
      battery_max_discharge_current_a: batteryCurrentValues.some((value) => value < 0) ? Math.abs(Math.min(...batteryCurrentValues.filter((value) => value < 0))) : null,
      battery_voltage_min_v: batteryVoltageValues.length ? Math.min(...batteryVoltageValues) : null,
      battery_voltage_max_v: batteryVoltageValues.length ? Math.max(...batteryVoltageValues) : null,
      object_temperature_min_c: objectTemperatureValues.length ? Math.min(...objectTemperatureValues) : null,
      object_temperature_max_c: objectTemperatureValues.length ? Math.max(...objectTemperatureValues) : null,
      active_charging_minutes: Math.round(activeChargingMs / 60_000),
      skipped_gaps: skippedGaps,
      unique_samples: history.length,
    },
  };
}
