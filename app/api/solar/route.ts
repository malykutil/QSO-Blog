import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";
import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { defaultSolarRelayState, solarTelemetryFields } from "@/src/lib/solar-data";

export const dynamic = "force-dynamic";

function validRpiRequest(request: NextRequest) {
  const token = process.env.SOLAR_RPI_TOKEN;
  return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
}

export async function GET() {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseRouteClient());
  if (!supabase) return NextResponse.json({ error: "Supabase není nastavené." }, { status: 503 });

  const [{ data: telemetry }, { data: relays }] = await Promise.all([
    supabase.from("solar_telemetry").select(solarTelemetryFields).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("solar_relay_states").select("relay,is_on,updated_at").order("relay"),
  ]);
  const relayState = { ...defaultSolarRelayState };
  for (const row of relays ?? []) if (row.relay in relayState) relayState[row.relay as keyof typeof relayState] = Boolean(row.is_on);
  return NextResponse.json({ telemetry: telemetry ?? null, relays: relayState, canControl: await hasSolarControlSession() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!validRpiRequest(request)) return NextResponse.json({ error: "Neplatný RPi token." }, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Neplatný JSON." }, { status: 400 }); }
  const allowed = ["solar1_current", "solar2_current", "battery_current", "object_temperature", "battery_temperature", "mppt_temperature"];
  const values = Object.fromEntries(allowed.map((key) => [key, typeof payload[key] === "number" && Number.isFinite(payload[key]) ? payload[key] : null]));
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseRouteClient());
  if (!supabase) return NextResponse.json({ error: "Supabase není nastavené." }, { status: 503 });
  const { error } = await supabase.from("solar_telemetry").insert(values);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
