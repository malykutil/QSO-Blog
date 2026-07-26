export const solarTelemetryFields =
  "solar1_voltage,solar2_voltage,battery_voltage,solar1_current,solar2_current,battery_current,solar1_power,solar2_power,load_power,solar_energy_today_wh,load_energy_today_wh,rpi_cpu_temperature,object_temperature,object_humidity,battery_temperature,outside_temperature,outside_pressure,mq9_raw,mq9_voltage,mppt_temperature,recorded_at";

export const solarRelayNames = ["solar1", "solar2", "battery", "bufik", "fan12v", "fan24v"] as const;
export type SolarRelayName = (typeof solarRelayNames)[number];

export type SolarTelemetry = {
  solar1_voltage: number | null;
  solar2_voltage: number | null;
  battery_voltage: number | null;
  solar1_current: number | null;
  solar2_current: number | null;
  battery_current: number | null;
  solar1_power: number | null;
  solar2_power: number | null;
  load_power: number | null;
  solar_energy_today_wh: number | null;
  load_energy_today_wh: number | null;
  rpi_cpu_temperature: number | null;
  object_temperature: number | null;
  object_humidity: number | null;
  battery_temperature: number | null;
  outside_temperature: number | null;
  outside_pressure: number | null;
  mq9_raw: number | null;
  mq9_voltage: number | null;
  mppt_temperature: number | null;
  recorded_at: string;
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
