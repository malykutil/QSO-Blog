export const solarTelemetryFields =
  "battery_voltage,solar1_current,solar2_current,battery_current,rpi_cpu_temperature,object_temperature,object_humidity,battery_temperature,outside_temperature,outside_pressure,mq9_raw,mq9_voltage,mppt_temperature,recorded_at";

export const solarExtendedTelemetryFields =
  "arduino_uptime_ms,battery_pressure,ina219_current,ina219_power,ina219_shunt_voltage_mv,acs1_raw,acs1_voltage,acs2_raw,acs2_voltage,acs3_raw,acs3_voltage,mq9_alarm,mq9_alarm_trigger_raw";

export const solarRelayNames = ["solar1", "solar2", "battery", "bufik", "fan12v", "fan24v"] as const;
export type SolarRelayName = (typeof solarRelayNames)[number];

export type SolarTelemetry = {
  battery_voltage: number | null;
  solar1_current: number | null;
  solar2_current: number | null;
  battery_current: number | null;
  rpi_cpu_temperature: number | null;
  object_temperature: number | null;
  object_humidity: number | null;
  battery_temperature: number | null;
  outside_temperature: number | null;
  outside_pressure: number | null;
  mq9_raw: number | null;
  mq9_voltage: number | null;
  mppt_temperature: number | null;
  arduino_uptime_ms: number | null;
  battery_pressure: number | null;
  ina219_current: number | null;
  ina219_power: number | null;
  ina219_shunt_voltage_mv: number | null;
  acs1_raw: number | null;
  acs1_voltage: number | null;
  acs2_raw: number | null;
  acs2_voltage: number | null;
  acs3_raw: number | null;
  acs3_voltage: number | null;
  mq9_alarm: boolean | null;
  mq9_alarm_trigger_raw: number | null;
  recorded_at: string;
};

export type BatteryFlowState = "charging" | "discharging" | "idle" | "unknown";
export type TelemetryFreshness = "online" | "delayed" | "offline";

export type SolarEnergyPoint = SolarTelemetry & {
  solar_total_current: number | null;
  battery_power_w: number | null;
  battery_state: BatteryFlowState;
  energy_charged_wh: number;
  energy_discharged_wh: number;
  energy_balance_wh: number;
};

export type SolarEnergySummary = {
  charged_energy_wh: number;
  discharged_energy_wh: number;
  energy_balance_wh: number;
  solar1_max_current_a: number | null;
  solar2_max_current_a: number | null;
  solar_total_max_current_a: number | null;
  active_charging_minutes: number;
  skipped_gaps: number;
  unique_samples: number;
};

export type SolarEnergyAnalysis = {
  history: SolarEnergyPoint[];
  summary: SolarEnergySummary;
};

export type SolarRelayState = Record<SolarRelayName, boolean>;

export const defaultSolarRelayState: SolarRelayState = {
  solar1: false,
  solar2: false,
  battery: false,
  bufik: false,
  fan12v: false,
  fan24v: false,
};
