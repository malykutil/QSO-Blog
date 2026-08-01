export const MQ9_AIR_QUALITY_CONFIG = {
  // Baseline measured in clean air on the installed module on 2026-08-01.
  cleanAirBaselineRaw: 520,
  goodMaxRatio: 1.15,
  degradedMaxRatio: 1.35,
  badMaxRatio: 1.6,
} as const;

export type Mq9AirQuality = {
  label: "Dobrá" | "Zhoršená" | "Špatná" | "Kritická" | "Nedostupná";
  tone: "neutral" | "positive" | "warning" | "negative";
  raw: number | null;
};

export const MQ9_CRITICAL_RAW = Math.round(
  MQ9_AIR_QUALITY_CONFIG.cleanAirBaselineRaw * MQ9_AIR_QUALITY_CONFIG.badMaxRatio,
);

export function isMq9Critical(rawValue: number | null | undefined) {
  return typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > MQ9_CRITICAL_RAW;
}

export function getMq9AirQuality(rawValue: number | null | undefined): Mq9AirQuality {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue < 0) {
    return { label: "Nedostupná", tone: "neutral", raw: null };
  }

  const ratio = rawValue / MQ9_AIR_QUALITY_CONFIG.cleanAirBaselineRaw;
  if (ratio <= MQ9_AIR_QUALITY_CONFIG.goodMaxRatio) {
    return { label: "Dobrá", tone: "positive", raw: rawValue };
  }
  if (ratio <= MQ9_AIR_QUALITY_CONFIG.degradedMaxRatio) {
    return { label: "Zhoršená", tone: "warning", raw: rawValue };
  }
  if (ratio <= MQ9_AIR_QUALITY_CONFIG.badMaxRatio) {
    return { label: "Špatná", tone: "negative", raw: rawValue };
  }
  return { label: "Kritická", tone: "negative", raw: rawValue };
}
