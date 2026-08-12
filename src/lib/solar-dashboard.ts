import type { SolarEnergyPoint, SolarRelayName, TelemetryFreshness } from "@/src/lib/solar-data";
import { getMq9AirQuality } from "@/src/lib/mq9-air-quality";

export const SOLAR_ALERT_THRESHOLDS = {
  batteryDisconnectedVoltageV: 0.5,
  batteryLowVoltageV: 11.8,
  batteryHighTemperatureC: 50,
  batteryChargingMinTemperatureC: 0,
  rpiHighTemperatureC: 75,
} as const;

export const SOLAR_RELAY_META: Record<SolarRelayName, {
  label: string;
  description: string;
  icon: SolarIconName;
  requiresConfirmation?: boolean;
}> = {
  solar1: { label: "Solární větev 1", description: "Vstup první solární větve", icon: "solar" },
  solar2: { label: "Solární větev 2", description: "Vstup druhé solární větve", icon: "solar" },
  battery: { label: "Bateriová větev", description: "Hlavní připojení baterie", icon: "battery", requiresConfirmation: true },
  bufik: { label: "Topení (bufík)", description: "Topení objektu", icon: "heat", requiresConfirmation: true },
  fan12v: { label: "Ventilátor 12 V", description: "Ventilace 12V větve", icon: "fan" },
  fan24v: { label: "Ventilátor 24 V", description: "Ventilace 24V větve", icon: "fan" },
  aux: { label: "Pomocné relé", description: "Pomocné relé na BCM GPIO 23", icon: "load", requiresConfirmation: true },
  aux2: { label: "Pomocné relé 2", description: "Pomocné relé na BCM GPIO 25", icon: "load", requiresConfirmation: true },
};

export type SolarIconName =
  | "solar"
  | "battery"
  | "current"
  | "load"
  | "system"
  | "clock"
  | "temperature"
  | "humidity"
  | "pressure"
  | "gas"
  | "fan"
  | "heat"
  | "alert";

export type SolarAlertLevel = "info" | "warning" | "critical";

export type SolarDashboardAlert = {
  id: string;
  level: SolarAlertLevel;
  title: string;
  detail: string;
};

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildSolarAlerts({
  telemetry,
  freshness,
  alarmActive,
  relayError,
}: {
  telemetry: SolarEnergyPoint | null;
  freshness: TelemetryFreshness;
  alarmActive: boolean;
  relayError?: string | null;
}): SolarDashboardAlert[] {
  const alerts: SolarDashboardAlert[] = [];
  if (alarmActive) {
    alerts.push({
      id: "mq9-alarm",
      level: "critical",
      title: "Kritická hodnota MQ-9",
      detail: "Nouzové vypnutí relé je aktivní. Objekt nejprve bezpečně zkontrolujte.",
    });
  }
  if (freshness === "offline") {
    alerts.push({
      id: "offline",
      level: "critical",
      title: "Řídicí jednotka je offline",
      detail: "Data jsou starší než 5 minut; zobrazené hodnoty jsou zastaralé.",
    });
  } else if (freshness === "delayed") {
    alerts.push({
      id: "delayed",
      level: "warning",
      title: "Telemetrie má zpoždění",
      detail: "Poslední měření je starší než 90 sekund.",
    });
  }

  const batteryVoltage = finite(telemetry?.battery_voltage);
  if (batteryVoltage !== null && batteryVoltage <= SOLAR_ALERT_THRESHOLDS.batteryDisconnectedVoltageV) {
    alerts.push({
      id: "battery-disconnected",
      level: "info",
      title: "Bateriový vstup je odpojený",
      detail: "INA219 neměří připojené napětí; zobrazuje se 0 V.",
    });
  } else if (batteryVoltage !== null && batteryVoltage < SOLAR_ALERT_THRESHOLDS.batteryLowVoltageV) {
    alerts.push({
      id: "battery-low",
      level: "critical",
      title: "Nízké napětí baterie",
      detail: `Naměřeno ${batteryVoltage.toFixed(2)} V, limit je ${SOLAR_ALERT_THRESHOLDS.batteryLowVoltageV.toFixed(1)} V. Zkontrolujte také zapojení INA219.`,
    });
  }

  const batteryTemperature = finite(telemetry?.battery_temperature);
  if (batteryTemperature !== null && batteryTemperature > SOLAR_ALERT_THRESHOLDS.batteryHighTemperatureC) {
    alerts.push({
      id: "battery-hot",
      level: "critical",
      title: "Vysoká teplota baterie",
      detail: `${batteryTemperature.toFixed(1)} °C překračuje limit ${SOLAR_ALERT_THRESHOLDS.batteryHighTemperatureC} °C.`,
    });
  }
  if (
    batteryTemperature !== null &&
    batteryTemperature < SOLAR_ALERT_THRESHOLDS.batteryChargingMinTemperatureC &&
    telemetry?.battery_state === "charging"
  ) {
    alerts.push({
      id: "battery-cold-charge",
      level: "warning",
      title: "Baterie je příliš studená pro nabíjení",
      detail: `${batteryTemperature.toFixed(1)} °C je pod nastaveným limitem ${SOLAR_ALERT_THRESHOLDS.batteryChargingMinTemperatureC} °C.`,
    });
  }

  const rpiTemperature = finite(telemetry?.rpi_cpu_temperature);
  if (rpiTemperature !== null && rpiTemperature > SOLAR_ALERT_THRESHOLDS.rpiHighTemperatureC) {
    alerts.push({
      id: "rpi-hot",
      level: "warning",
      title: "Raspberry Pi má vysokou teplotu",
      detail: `CPU má ${rpiTemperature.toFixed(1)} °C, limit je ${SOLAR_ALERT_THRESHOLDS.rpiHighTemperatureC} °C.`,
    });
  }

  if (relayError) {
    alerts.push({ id: "relay-error", level: "warning", title: "Příkaz relé nebyl potvrzen", detail: relayError });
  }

  if (!alerts.length && telemetry) {
    const airQuality = getMq9AirQuality(telemetry.mq9_raw);
    alerts.push({
      id: "all-clear",
      level: "info",
      title: "Systém bez aktivních kritických upozornění",
      detail: `Telemetrie je v pořádku, stav vzduchu: ${airQuality.label.toLowerCase()}.`,
    });
  }
  return alerts;
}
