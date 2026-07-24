import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const latitude = Number(process.env.WEATHER_LATITUDE ?? "49.4398092");
const longitude = Number(process.env.WEATHER_LONGITUDE ?? "18.0245583");
const timezone = process.env.WEATHER_TIMEZONE ?? "Europe/Prague";
const panelWp = Number(process.env.SOLAR_TOTAL_WP ?? "300");
const performanceRatio = Number(process.env.SOLAR_PERFORMANCE_RATIO ?? "0.75");

export async function GET() {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone,
    forecast_days: "7",
    current: "temperature_2m,weather_code,cloud_cover,shortwave_radiation",
    hourly: "temperature_2m,weather_code,shortwave_radiation,precipitation_probability",
    daily: "temperature_2m_min,temperature_2m_max,weather_code,sunrise,sunset,shortwave_radiation_sum",
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, { next: { revalidate: 900 } });
    if (!response.ok) return NextResponse.json({ error: "Předpověď počasí není dostupná." }, { status: 502 });
    const raw = await response.json();
    const daily = (raw.daily?.time ?? []).map((date: string, index: number) => {
      const radiation = Number(raw.daily.shortwave_radiation_sum?.[index] ?? 0);
      const estimatedKwh = radiation * 0.277778 * (panelWp / 1000) * performanceRatio;
      return {
        date,
        min: raw.daily.temperature_2m_min?.[index] ?? null,
        max: raw.daily.temperature_2m_max?.[index] ?? null,
        weatherCode: raw.daily.weather_code?.[index] ?? null,
        sunrise: raw.daily.sunrise?.[index] ?? null,
        sunset: raw.daily.sunset?.[index] ?? null,
        radiation,
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
    return NextResponse.json({ location: { latitude, longitude, timezone }, panelWp, performanceRatio, current: raw.current ?? null, daily, hourly, automation: { enabled: false, batteryHeatBelowC: 10, cabinHeaterNightBelowC: -10, relayMappingReady: false } }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return NextResponse.json({ error: "Předpověď počasí není dostupná." }, { status: 502 });
  }
}
