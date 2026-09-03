import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";
import { canManageSolarControl } from "@/src/lib/solar-control-access";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 300_000;
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const clamp = (value: number) => Math.max(0, Math.min(100, value));

function evaluate(sample: Record<string, unknown> | null, previous: Record<string, unknown>[]) {
  if (!sample) return { energyState: "FAILSAFE", score: 0, confidence: 0, reason: "Telemetrie není dostupná." };
  const recorded = new Date(String(sample.recorded_at)).getTime();
  if (!Number.isFinite(recorded) || Date.now() - recorded > TIMEOUT_MS) return { energyState: "FAILSAFE", score: 0, confidence: 0, reason: "Telemetrie je starší než 5 minut." };
  const battery = finite(sample.battery_voltage);
  const solar = Math.max(0, finite(sample.solar_power) ?? ((finite(sample.solar1_current) ?? 0) + (finite(sample.solar2_current) ?? 0)) * (battery ?? 0));
  const load = Math.max(0, finite(sample.load_power) ?? 0);
  if (battery === null) return { energyState: "FAILSAFE", score: 0, confidence: 0, reason: "Chybí napětí baterie." };
  const earlier = previous.find((row) => finite(row.battery_voltage) !== null);
  const batteryTrend = earlier ? (battery - (finite(earlier.battery_voltage) ?? battery)) : 0;
  const score = Math.round(clamp(((battery - 11.6) / 1.4) * 30 + (solar / 350) * 25 + (50 + batteryTrend * 80) * 0.15 + ((solar - load + 100) / 400 * 100) * 0.25 + 5));
  const energyState = score <= 15 ? "CRITICAL" : score <= 30 ? "LOW" : score <= 55 ? "NORMAL" : score <= 75 ? "GOOD" : "SURPLUS";
  return { energyState, score, confidence: Number(Math.min(0.95, 0.4 + previous.length / 240).toFixed(2)), reason: `Výroba ${solar.toFixed(0)} W a spotřeba ${load.toFixed(0)} W; baterie ${battery.toFixed(2)} V.` };
}

async function client() { return getSupabaseAdminClient() ?? await getSupabaseRouteClient(); }

export async function GET() {
  const supabase = await client();
  if (!supabase) return NextResponse.json({ error: "Supabase není nakonfigurovaný." }, { status: 503 });
  const [telemetryResult, relayResult, settingResult, relayModesResult] = await Promise.all([
    supabase.from("solar_telemetry").select("battery_voltage,solar1_current,solar2_current,solar1_power,solar2_power,load_power,object_temperature,mppt_temperature,recorded_at").order("recorded_at", { ascending: false }).limit(241),
    supabase.from("solar_relay_states").select("relay,is_on").in("relay", ["aux", "aux2", "bufik", "fan12v", "fan24v"]),
    supabase.from("solar_auto_settings").select("enabled").eq("id", 1).maybeSingle(),
    supabase.from("solar_relay_modes").select("relay,mode"),
  ]);
  if (telemetryResult.error) return NextResponse.json({ error: telemetryResult.error.message }, { status: 500 });
  const rows = (telemetryResult.data ?? []) as Record<string, unknown>[];
  const latest = rows[0] ?? null;
  const ordered = [...rows].reverse();
  const result = evaluate(latest, ordered);
  const relays = Object.fromEntries((relayResult.data ?? []).map((row) => [row.relay, Boolean(row.is_on)]));
  const relay1 = Boolean(relays.aux), relay2 = Boolean(relays.aux2);
  return NextResponse.json({ enabled: settingResult.data?.enabled === true, energy_state: result.energyState, energy_score: result.score, confidence: result.confidence, reason: result.reason, battery: { voltage: finite(latest?.battery_voltage), connected: relay1 && relay2, relay_pair: { relay_1: relay1, relay_2: relay2, logical_state: relay1 === relay2 ? relay1 ? "BATTERY_CONNECTED" : "BATTERY_DISCONNECTED" : "BATTERY_RELAY_MISMATCH", feedback_available: false } }, solar: { power: finite(latest?.solar1_power) ?? 0 }, load: { power: finite(latest?.load_power) ?? 0 }, actions: { bufik: Boolean(relays.bufik), fan12v: Boolean(relays.fan12v), fan24v: Boolean(relays.fan24v) }, relay_modes: relayModesResult.error ? {} : Object.fromEntries((relayModesResult.data ?? []).map((row) => [row.relay, row.mode])), last_decision: latest?.recorded_at ?? null });
}

export async function POST(request: NextRequest) {
  if (!(await canManageSolarControl())) return NextResponse.json({ error: "Ovládání AUTO vyžaduje oprávněné přihlášení." }, { status: 403 });
  const supabase = await client();
  if (!supabase) return NextResponse.json({ error: "Supabase není nakonfigurovaný." }, { status: 503 });
  const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
  if (!body || typeof body.enabled !== "boolean") return NextResponse.json({ error: "Očekává se enabled: boolean." }, { status: 400 });
  const { error } = await supabase.from("solar_auto_settings").upsert({ id: 1, enabled: body.enabled });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, enabled: body.enabled });
}
