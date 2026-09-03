import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";
import { analyzeSolarEnergy } from "@/src/lib/solar-energy";
import { isMq9Critical } from "@/src/lib/mq9-air-quality";
import type { SolarTelemetry } from "@/src/lib/solar-data";

export const dynamic = "force-dynamic";

const AUTOMATION_RELAY = "fan12v";
const SOLAR_RELAY = "solar1";
const TEMPERATURE_OFF_C = 22;
const HISTORY_HOURS = 1;

async function askGptAboutHour(samples: SolarTelemetry[], result: {
  currentTemperature: number | null;
  trendCPerHour: number | null;
  batteryVoltage: number | null;
  solarCurrent: number | null;
  solarEnergyWhLastHour: number;
  fan12v: boolean;
  solar1: boolean;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const compactSamples = samples.map((sample) => ({
    recorded_at: sample.recorded_at,
    object_temperature: sample.object_temperature,
    battery_voltage: sample.battery_voltage,
    solar1_current: sample.solar1_current,
    solar2_current: sample.solar2_current,
    battery_current: sample.battery_current,
  }));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
      input: [
        {
          role: "system",
          content: "Jsi stručný energetický analytik. Vyhodnoť hodinová data chaty v češtině. Neovládej zařízení a nenavrhuj změnu bezpečnostních limitů. Uveď solární energii, trend teploty, baterii, stav relé a jednu krátkou poznámku.",
        },
        {
          role: "user",
          content: JSON.stringify({ summary: result, samples: compactSamples }),
        },
      ],
      text: { verbosity: "low" },
      max_output_tokens: 300,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const payload = await response.json() as { output_text?: string };
  return payload.output_text ?? null;
}

function hasValidCronSecret(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function temperatureTrendCPerHour(samples: SolarTelemetry[]) {
  const points = samples
    .map((sample) => ({
      time: new Date(sample.recorded_at).getTime(),
      temperature: sample.object_temperature,
    }))
    .filter((point): point is { time: number; temperature: number } => Number.isFinite(point.time) && typeof point.temperature === "number" && Number.isFinite(point.temperature))
    .sort((a, b) => a.time - b.time);

  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const elapsedHours = (last.time - first.time) / 3_600_000;
  if (elapsedHours <= 0) return null;
  return (last.temperature - first.temperature) / elapsedHours;
}

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request)) return NextResponse.json({ error: "Neplatný cron token." }, { status: 401 });

  const supabase = getSupabaseAdminClient() ?? await getSupabaseRouteClient();
  if (!supabase) return NextResponse.json({ error: "Supabase service role není nakonfigurovaná." }, { status: 503 });

  const since = new Date(Date.now() - HISTORY_HOURS * 60 * 60 * 1000).toISOString();
  const [telemetryResult, relayResult] = await Promise.all([
    supabase
      .from("solar_telemetry")
      .select("solar1_voltage,solar2_voltage,solar1_power,solar2_power,load_power,solar_energy_today_wh,load_energy_today_wh,battery_voltage,solar1_current,solar2_current,battery_current,rpi_cpu_temperature,object_temperature,object_humidity,battery_temperature,outside_temperature,outside_pressure,mq9_raw,mq9_voltage,mppt_temperature,recorded_at")
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true }),
    supabase.from("solar_relay_states").select("relay,is_on").in("relay", [AUTOMATION_RELAY, SOLAR_RELAY]),
  ]);

  if (telemetryResult.error) return NextResponse.json({ error: telemetryResult.error.message }, { status: 500 });
  if (relayResult.error) return NextResponse.json({ error: relayResult.error.message }, { status: 500 });

  const samples = (telemetryResult.data ?? []) as unknown as SolarTelemetry[];
  const latest = samples.at(-1) ?? null;
  const trendCPerHour = temperatureTrendCPerHour(samples);
  const analysis = analyzeSolarEnergy(samples);
  const currentTemperature = latest?.object_temperature ?? null;
  const batteryVoltage = latest?.battery_voltage ?? null;
  const solarCurrent = latest?.solar1_current ?? null;
  const alarmActive = Boolean(latest && isMq9Critical(latest.mq9_raw));
  const currentStates = Object.fromEntries((relayResult.data ?? []).map((row) => [row.relay, Boolean(row.is_on)]));
  const currentFanState = Boolean(currentStates[AUTOMATION_RELAY]);
  const currentSolarState = Boolean(currentStates[SOLAR_RELAY]);

  let desiredFanState = currentFanState;
  let reason = "Nedostatek platných dat.";
  if (latest && currentTemperature !== null && !alarmActive) {
    desiredFanState = currentTemperature < TEMPERATURE_OFF_C
      ? false
      : currentFanState || (trendCPerHour !== null && trendCPerHour > 0);
    reason = currentTemperature < TEMPERATURE_OFF_C
      ? `Teplota ${currentTemperature.toFixed(1)} °C je pod limitem.`
      : trendCPerHour !== null && trendCPerHour > 0
        ? `Teplota roste trendem ${trendCPerHour.toFixed(2)} °C/h.`
        : desiredFanState
          ? "Odtah zůstává zapnutý do poklesu pod 22 °C."
          : "Teplota neroste; odtah zůstává vypnutý.";
  } else if (alarmActive) {
    desiredFanState = false;
    reason = "MQ-9 poplach — odtah vypnut.";
  }

  const updates = [
    desiredFanState !== currentFanState ? { relay: AUTOMATION_RELAY, is_on: desiredFanState } : null,
  ].filter((update): update is { relay: string; is_on: boolean } => update !== null);
  if (updates.length) {
    const { error } = await supabase.from("solar_relay_states").upsert(updates);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let gptAnalysis: string | null = null;
  let gptError: string | null = null;
  try {
    gptAnalysis = await askGptAboutHour(samples, {
      currentTemperature,
      trendCPerHour,
      batteryVoltage,
      solarCurrent,
      solarEnergyWhLastHour: analysis.summary.battery_charged_wh,
      fan12v: desiredFanState,
      solar1: currentSolarState,
    });
  } catch (error) {
    gptError = error instanceof Error ? error.message : "Neznámá chyba OpenAI API.";
  }

  return NextResponse.json({
    ok: true,
    fan: { relay: AUTOMATION_RELAY, changed: desiredFanState !== currentFanState, isOn: desiredFanState, reason },
    solar1: { relay: SOLAR_RELAY, changed: false, isOn: currentSolarState, reason: "Automatické řízení solární větve je vypnuté; stav lze změnit pouze ručně." },
    samples: samples.length,
    currentTemperature,
    trendCPerHour,
    batteryVoltage,
    solarCurrent,
    solarEnergyWhLastHour: analysis.summary.battery_charged_wh,
    solarChargeAhLastHour: analysis.summary.battery_charged_ah,
    activeSolarMinutes: analysis.summary.active_charging_minutes,
    gptAnalysis,
    gptError,
    evaluatedAt: new Date().toISOString(),
  });
}
