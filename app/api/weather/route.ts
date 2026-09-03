import { NextResponse } from "next/server";

import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";

export const dynamic = "force-dynamic";

const latitude = Number(process.env.WEATHER_LATITUDE ?? "49.4398092");
const longitude = Number(process.env.WEATHER_LONGITUDE ?? "18.0245583");
const timezone = process.env.WEATHER_TIMEZONE ?? "Europe/Prague";
const panelWp = Number(process.env.SOLAR_TOTAL_WP ?? "500");
const performanceRatio = Number(process.env.SOLAR_PERFORMANCE_RATIO ?? "0.70");
const panelTilt = Number(process.env.SOLAR_PANEL_TILT ?? "45");
const panelAzimuth = Number(process.env.SOLAR_PANEL_AZIMUTH ?? "90");

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dewPointCelsius(temperature: number, humidity: number) {
  const a = 17.62;
  const b = 243.12;
  const gamma = Math.log(humidity / 100) + (a * temperature) / (b + temperature);
  return (b * gamma) / (a - gamma);
}

async function loadLocalWeatherCorrection() {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseRouteClient());
  if (!supabase) return null;
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("solar_telemetry")
    .select("recorded_at,outside_pressure,outside_temperature,outside_humidity")
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true })
    .limit(600);
  if (error || !data?.length) return null;

  const samples = data.map((row) => ({
    recordedAt: new Date(String(row.recorded_at)).getTime(),
    pressure: finite(row.outside_pressure),
    temperature: finite(row.outside_temperature),
    humidity: finite(row.outside_humidity),
  })).filter((row) => Number.isFinite(row.recordedAt));
  const latest = samples.at(-1);
  if (!latest) return null;
  const pressureSamples = samples.filter((sample) => sample.pressure !== null);
  const firstPressure = pressureSamples[0];
  const elapsedHours = firstPressure && latest.recordedAt > firstPressure.recordedAt
    ? (latest.recordedAt - firstPressure.recordedAt) / 3_600_000
    : null;
  const pressureTrend = latest.pressure !== null && firstPressure?.pressure !== null && elapsedHours && elapsedHours > 0.1
    ? (latest.pressure - firstPressure.pressure) / elapsedHours
    : null;
  const dewPoint = latest.temperature !== null && latest.humidity !== null && latest.humidity > 0
    ? dewPointCelsius(latest.temperature, latest.humidity)
    : null;

  let adjustmentFactor = 1;
  const reasons: string[] = [];
  if (pressureTrend !== null && pressureTrend < -1.5) {
    adjustmentFactor *= 0.88;
    reasons.push("tlak rychle klesá");
  } else if (pressureTrend !== null && pressureTrend < -0.6) {
    adjustmentFactor *= 0.94;
    reasons.push("tlak mírně klesá");
  } else if (pressureTrend !== null && pressureTrend > 1.5) {
    adjustmentFactor *= 1.04;
    reasons.push("tlak roste");
  }
  if (latest.humidity !== null && latest.humidity >= 90 && dewPoint !== null && latest.temperature !== null && latest.temperature - dewPoint < 2) {
    adjustmentFactor *= 0.90;
    reasons.push("velmi vlhký vzduch / riziko nízké oblačnosti");
  } else if (latest.humidity !== null && latest.humidity >= 80) {
    adjustmentFactor *= 0.96;
    reasons.push("vyšší vlhkost");
  }
  adjustmentFactor = Math.max(0.75, Math.min(1.05, adjustmentFactor));
  return {
    available: true,
    sampleCount: samples.length,
    pressureHpa: latest.pressure,
    pressureTrendHpaPerHour: pressureTrend === null ? null : Number(pressureTrend.toFixed(2)),
    temperatureC: latest.temperature,
    humidityPercent: latest.humidity,
    dewPointC: dewPoint === null ? null : Number(dewPoint.toFixed(1)),
    adjustmentFactor: Number(adjustmentFactor.toFixed(2)),
    summary: reasons.length ? reasons.join(", ") : "lokální čidla nehlásí výraznou změnu",
  };
}

async function loadSolcastForecast() {
  const apiKey = process.env.SOLCAST_API_KEY;
  if (!apiKey) return null;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hours: "168",
    period: "PT30M",
    output_parameters: "pv_power_rooftop",
    capacity: String((panelWp / 1000).toFixed(3)),
    azimuth: String(panelAzimuth),
    tilt: String(panelTilt),
    loss_factor: String((1 - performanceRatio).toFixed(2)),
    format: "json",
  });
  const response = await fetch(`https://api.solcast.com.au/data/forecast/rooftop_pv_power?${params.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 900 },
  });
  if (!response.ok) return null;
  const payload = await response.json();
  const daily = new Map<string, number>();
  for (const item of payload.forecasts ?? []) {
    const date = String(item.period_end).slice(0, 10);
    const periodHours = String(item.period) === "PT30M" ? 0.5 : 1;
    daily.set(date, (daily.get(date) ?? 0) + Number(item.pv_power_rooftop ?? 0) * periodHours);
  }
  return daily;
}

export async function GET() {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone,
    forecast_days: "7",
    current: "temperature_2m,weather_code,cloud_cover,shortwave_radiation",
    hourly: "temperature_2m,weather_code,shortwave_radiation,global_tilted_irradiance,precipitation_probability",
    daily: "temperature_2m_min,temperature_2m_max,weather_code,sunrise,sunset",
    tilt: String(panelTilt),
    azimuth: String(panelAzimuth),
  });

  try {
    const [response, solcastDaily, localWeather] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { next: { revalidate: 900 } }),
      loadSolcastForecast().catch(() => null),
      loadLocalWeatherCorrection().catch(() => null),
    ]);
    if (!response.ok) return NextResponse.json({ error: "Předpověď počasí není dostupná." }, { status: 502 });
    const raw = await response.json();
    const tiltedRadiationByDay = new Map<string, number>();
    (raw.hourly?.time ?? []).forEach((time: string, index: number) => {
      const date = time.slice(0, 10);
      tiltedRadiationByDay.set(date, (tiltedRadiationByDay.get(date) ?? 0) + Number(raw.hourly.global_tilted_irradiance?.[index] ?? 0));
    });
    const daily = (raw.daily?.time ?? []).map((date: string, index: number) => {
      const radiation = tiltedRadiationByDay.get(date) ?? 0;
      const baseEstimatedKwh = solcastDaily?.get(date) ?? radiation * (panelWp / 1000) * performanceRatio / 1000;
      const estimatedKwh = baseEstimatedKwh * (localWeather?.adjustmentFactor ?? 1);
      return {
        date,
        min: raw.daily.temperature_2m_min?.[index] ?? null,
        max: raw.daily.temperature_2m_max?.[index] ?? null,
        weatherCode: raw.daily.weather_code?.[index] ?? null,
        sunrise: raw.daily.sunrise?.[index] ?? null,
        sunset: raw.daily.sunset?.[index] ?? null,
        radiation: Number(radiation.toFixed(0)),
        baseEstimatedKwh: Number(baseEstimatedKwh.toFixed(2)),
        estimatedKwh: Number(estimatedKwh.toFixed(2)),
      };
    });
    const hourly = (raw.hourly?.time ?? []).slice(0, 72).map((time: string, index: number) => ({
      time,
      temperature: raw.hourly.temperature_2m?.[index] ?? null,
      weatherCode: raw.hourly.weather_code?.[index] ?? null,
      radiation: raw.hourly.shortwave_radiation?.[index] ?? null,
      precipitationProbability: raw.hourly.precipitation_probability?.[index] ?? null,
    }));
    const forecastSource = solcastDaily
      ? (localWeather ? "Solcast + lokální čidla" : "Solcast")
      : (localWeather ? "Open-Meteo + lokální čidla" : "Open-Meteo");
    return NextResponse.json({ location: { latitude, longitude, timezone }, forecastSource, panelWp, performanceRatio, panelOrientation: { tilt: panelTilt, azimuth: panelAzimuth, direction: "západ" }, current: raw.current ?? null, localWeather, daily, hourly, automation: { enabled: false, batteryHeatBelowC: 10, cabinHeaterNightBelowC: -10, relayMappingReady: false } }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Předpověď počasí není dostupná." }, { status: 502 });
  }
}
