export const solarTelemetryFields =
  "solar1_current,solar2_current,battery_current,object_temperature,battery_temperature,mppt_temperature,recorded_at";

export const solarRelayNames = ["solar1", "solar2", "battery", "bufik", "fan12v", "fan24v"] as const;
export type SolarRelayName = (typeof solarRelayNames)[number];

export type SolarTelemetry = {
  solar1_current: number | null;
  solar2_current: number | null;
  battery_current: number | null;
  object_temperature: number | null;
  battery_temperature: number | null;
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
