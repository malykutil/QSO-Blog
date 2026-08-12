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
  temperatureMinC: -50,
  temperatureMaxC: 100,
  maxTemperatureJumpC: 20,
} as const;

const TEMPERATURE_FIELDS = [
  "rpi_cpu_temperature",
  "object_temperature",
  "battery_temperature",
  "outside_temperature",
  "mppt_temperature",
] as const;

type TemperatureField = (typeof TEMPERATURE_FIELDS)[number];

export function isPlausibleTemperature(value: number, previousValue?: number | null) {
  if (!Number.isFinite(value)) return false;
  if (value < SOLAR_MEASUREMENT_CONFIG.temperatureMinC || value > SOLAR_MEASUREMENT_CONFIG.temperatureMaxC) return false;
  return previousValue === undefined || previousValue === null || Math.abs(value - previousValue) <= SOLAR_MEASUREMENT_CONFIG.maxTemperatureJumpC;
}

export function sanitizeTemperatureFields(
  sample: Record<string, unknown>,
  previousSample?: Record<string, unknown> | null,
) {
  const sanitized = { ...sample };
  for (const key of TEMPERATURE_FIELDS) {
    const value = sanitized[key];
    if (typeof value !== "number") continue;
    const previousValue = previousSample?.[key];
    if (!isPlausibleTemperature(value, typeof previousValue === "number" ? previousValue : null)) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

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
) {
  return finite(solar1Current);
}

// DB field names are historical. Physical wiring: ACS1 = battery,
// ACS2 = load, ACS3 = solar. Battery sign is inverted for the UI.
export function calculateBatteryFlowCurrent(sample: SolarTelemetry) {
  const batteryCurrent = finite(sample.solar1_current);
  return batteryCurrent === null ? null : -batteryCurrent;
}

function calculatePower(voltage: number | null | undefined, current: number | null | undefined) {
  const safeVoltage = finite(voltage);
  const safeCurrent = finite(current);
  return safeVoltage === null || safeCurrent === null ? null : safeVoltage * safeCurrent;
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
  const solarTotalCurrent = calculateSolarTotalCurrent(sample.battery_current);
  const loadVoltage = finite(sample.solar2_voltage);
  const loadCurrent = finite(sample.solar2_current);
  const batteryFlowCurrent = calculateBatteryFlowCurrent(sample);
  const batteryPower = calculatePower(sample.battery_voltage, batteryFlowCurrent);
  const measuredLoadPower = finite(sample.load_power);
  const loadPower = measuredLoadPower ?? calculatePower(loadVoltage, loadCurrent);
  // Legacy INA219 columns carry the dedicated Waveshare UPS HAT values from RPi.
  const upsVoltage = finite(sample.ina219_shunt_voltage_mv);
  const upsCurrent = finite(sample.ina219_current);
  return {
    ...sample,
    // solar1_voltage je DB kompatibilni transport vlhkosti DHT11 na D12;
    // napeti solarniho panelu tato instalace nemeri.
    mppt_humidity: finite(sample.solar1_voltage),
    solar_total_current: solarTotalCurrent,
    battery_flow_current_a: batteryFlowCurrent,
    load_voltage_v: loadVoltage,
    load_current_a: loadCurrent,
    battery_power_w: batteryPower,
    load_power_w: loadPower,
    // User-facing wiring after the requested value swap: A2 is displayed as
    // battery current, while inverted A1 is displayed as load current.
    battery_state: getBatteryFlowState(sample.battery_voltage, loadCurrent),
    ups_voltage_v: upsVoltage,
    ups_current_a: upsCurrent,
    ups_charge_percent: calculateUpsChargePercent(upsVoltage),
    ups_state: getUpsFlowState(upsCurrent),
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
  const previousValidTemperatures: Partial<Record<TemperatureField, number>> = {};
  const history = ordered.map((sample) => {
    const sanitized = sanitizeTemperatureFields(sample as unknown as Record<string, unknown>, previousValidTemperatures);
    for (const key of TEMPERATURE_FIELDS) {
      const value = sanitized[key];
      if (typeof value === "number" && isPlausibleTemperature(value, previousValidTemperatures[key])) {
        previousValidTemperatures[key] = value;
      }
    }
    return enrichSolarTelemetry(sanitized as unknown as SolarTelemetry);
  });
  let activeChargingMs = 0;
  let skippedGaps = 0;
  let solar1Ah = 0;
  let loadAh = 0;
  let batteryChargedAh = 0;
  let batteryDischargedAh = 0;
  let batteryChargedWh = 0;
  let batteryDischargedWh = 0;
  let loadEnergyWh = 0;
  let consumptionEnergyWh = 0;

  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    const elapsedMs = new Date(current.recorded_at).getTime() - new Date(previous.recorded_at).getTime();

    if (elapsedMs <= 0 || elapsedMs > SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs) {
      skippedGaps += elapsedMs > SOLAR_MEASUREMENT_CONFIG.maxIntegrationGapMs ? 1 : 0;
      current.solar1_ah = solar1Ah;
      current.solar2_ah = loadAh;
      current.solar_total_ah = solar1Ah;
      current.load_ah = loadAh;
      current.battery_charged_ah = batteryChargedAh;
      current.battery_discharged_ah = batteryDischargedAh;
      current.battery_net_ah = batteryChargedAh - batteryDischargedAh;
      current.battery_charged_wh = batteryChargedWh;
      current.battery_discharged_wh = batteryDischargedWh;
      current.load_energy_wh = loadEnergyWh;
      current.consumption_energy_wh = consumptionEnergyWh;
      continue;
    }

    const intervalHours = elapsedMs / 3_600_000;
    if (previous.solar_total_current !== null && current.solar_total_current !== null) {
      solar1Ah += Math.max(0, (previous.solar_total_current + current.solar_total_current) / 2) * intervalHours;
    }
    if (previous.load_current_a !== null && current.load_current_a !== null) {
      loadAh += Math.max(0, (previous.load_current_a + current.load_current_a) / 2) * intervalHours;
    }
    if (previous.load_power_w !== null && current.load_power_w !== null) {
      loadEnergyWh += Math.max(0, (previous.load_power_w + current.load_power_w) / 2) * intervalHours;
    }
    const previousDisplayedBatteryCurrent = previous.load_current_a;
    const currentDisplayedBatteryCurrent = current.load_current_a;
    const averageBatteryCurrent = previousDisplayedBatteryCurrent !== null && currentDisplayedBatteryCurrent !== null
      ? (previousDisplayedBatteryCurrent + currentDisplayedBatteryCurrent) / 2
      : null;
    if (averageBatteryCurrent !== null && averageBatteryCurrent > 0) {
      batteryChargedAh += averageBatteryCurrent * intervalHours;
      if (previous.load_power_w !== null && current.load_power_w !== null) {
        batteryChargedWh += (Math.abs(previous.load_power_w) + Math.abs(current.load_power_w)) / 2 * intervalHours;
      }
      if (previous.battery_flow_current_a !== null && current.battery_flow_current_a !== null) {
        batteryDischargedAh += Math.abs((previous.battery_flow_current_a + current.battery_flow_current_a) / 2) * intervalHours;
      }
      if (previous.battery_power_w !== null && current.battery_power_w !== null) {
        const intervalLoadWh = (Math.abs(previous.battery_power_w) + Math.abs(current.battery_power_w)) / 2 * intervalHours;
        batteryDischargedWh += intervalLoadWh;
        consumptionEnergyWh += intervalLoadWh;
      }
    } else if (averageBatteryCurrent !== null && averageBatteryCurrent < 0) {
      batteryDischargedAh += Math.abs(averageBatteryCurrent) * intervalHours;
      if (previous.load_power_w !== null && current.load_power_w !== null) {
        const intervalBatteryWh = (Math.abs(previous.load_power_w) + Math.abs(current.load_power_w)) / 2 * intervalHours;
        batteryDischargedWh += intervalBatteryWh;
        consumptionEnergyWh += intervalBatteryWh;
      }
    }

    const previousSolarActive = previous.solar_total_current !== null && previous.solar_total_current > SOLAR_MEASUREMENT_CONFIG.solarActiveCurrentThresholdA;
    const currentSolarActive = current.solar_total_current !== null && current.solar_total_current > SOLAR_MEASUREMENT_CONFIG.solarActiveCurrentThresholdA;
    if (previousSolarActive || currentSolarActive) activeChargingMs += elapsedMs;

    current.solar1_ah = solar1Ah;
    current.solar2_ah = loadAh;
    current.solar_total_ah = solar1Ah;
    current.load_ah = loadAh;
    current.battery_charged_ah = batteryChargedAh;
    current.battery_discharged_ah = batteryDischargedAh;
    current.battery_net_ah = batteryChargedAh - batteryDischargedAh;
    current.battery_charged_wh = batteryChargedWh;
    current.battery_discharged_wh = batteryDischargedWh;
    current.load_energy_wh = loadEnergyWh;
    current.consumption_energy_wh = consumptionEnergyWh;
  }

  const numeric = (key: keyof SolarEnergyPoint) =>
    history
      .map((sample) => sample[key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const solar1Values = numeric("solar_total_current");
  const loadValues = numeric("load_current_a");
  const solarTotalValues = numeric("solar_total_current");
  const batteryCurrentValues = numeric("load_current_a");
  const batteryVoltageValues = numeric("battery_voltage");
  const objectTemperatureValues = numeric("object_temperature");

  return {
    history,
    summary: {
      solar1_max_current_a: solar1Values.length ? Math.max(...solar1Values) : null,
      solar2_max_current_a: loadValues.length ? Math.max(...loadValues) : null,
      solar_total_max_current_a: solarTotalValues.length ? Math.max(...solarTotalValues) : null,
      load_max_current_a: loadValues.length ? Math.max(...loadValues) : null,
      solar1_ah: solar1Ah,
      solar2_ah: loadAh,
      solar_total_ah: solar1Ah,
      load_ah: loadAh,
      battery_charged_ah: batteryChargedAh,
      battery_discharged_ah: batteryDischargedAh,
      battery_net_ah: batteryChargedAh - batteryDischargedAh,
      battery_charged_wh: batteryChargedWh,
      battery_discharged_wh: batteryDischargedWh,
      load_energy_wh: loadEnergyWh,
      consumption_energy_wh: consumptionEnergyWh,
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
