import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";
import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { defaultSolarRelayState, solarTelemetryFields } from "@/src/lib/solar-data";

export const dynamic = "force-dynamic";

function validRpiRequest(request: NextRequest) {
  const token = process.env.SOLAR_RPI_TOKEN;
  return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
}

async function canManageSolar() {
  if (await hasSolarControlSession()) return true;
  const supabase = await getSupabaseRouteClient();
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: owner } = await supabase.from("app_owners").select("user_id").eq("user_id", user.id).maybeSingle();
  return Boolean(owner);
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseRouteClient());
  if (!supabase) return NextResponse.json({ error: "Supabase není nastavené." }, { status: 503 });

  const range = request.nextUrl.searchParams.get("range") ?? "24h";
  const rangeHours = range === "1h" ? 1 : range === "7d" ? 24 * 7 : range === "30d" ? 24 * 30 : 24;

  const [{ data: telemetry }, { data: history }, { data: relays }] = await Promise.all([
    supabase.from("solar_telemetry").select(solarTelemetryFields).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("solar_telemetry").select(solarTelemetryFields).gte("recorded_at", new Date(Date.now() - rangeHours * 60 * 60 * 1000).toISOString()).order("recorded_at", { ascending: true }).limit(1000),
    supabase.from("solar_relay_states").select("relay,is_on,updated_at").order("relay"),
  ]);
  const relayState = { ...defaultSolarRelayState };
  for (const row of relays ?? []) if (row.relay in relayState) relayState[row.relay as keyof typeof relayState] = Boolean(row.is_on);
  return NextResponse.json({ telemetry: telemetry ?? null, history: history ?? [], relays: relayState, canControl: await canManageSolar() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!validRpiRequest(request)) return NextResponse.json({ error: "Neplatný RPi token." }, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Neplatný JSON." }, { status: 400 }); }
  const allowed = ["solar1_voltage", "solar2_voltage", "battery_voltage", "solar1_current", "solar2_current", "battery_current", "solar1_power", "solar2_power", "load_power", "solar_energy_today_wh", "load_energy_today_wh", "object_temperature", "object_humidity", "battery_temperature", "outside_temperature", "outside_pressure", "mq9_raw", "mq9_voltage", "mppt_temperature"];
  const values = Object.fromEntries(allowed.map((key) => [key, typeof payload[key] === "number" && Number.isFinite(payload[key]) ? payload[key] : null]));
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseRouteClient());
  if (!supabase) return NextResponse.json({ error: "Supabase není nastavené." }, { status: 503 });
  const { error } = await supabase.from("solar_telemetry").insert(values);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
