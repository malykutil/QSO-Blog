import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/src/lib/supabase-server";
import { defaultSolarRelayState, solarRelayNames, solarTelemetryFields, type SolarRelayName } from "@/src/lib/solar-data";

export const dynamic = "force-dynamic";

function validDeviceRequest(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const validTokens = [process.env.SOLAR_DEVICE_TOKEN, process.env.SOLAR_RPI_TOKEN].filter(Boolean).map((token) => `Bearer ${token}`);
  return Boolean(authorization && validTokens.includes(authorization));
}

export async function GET(request: NextRequest) {
  if (!validDeviceRequest(request)) return NextResponse.json({ error: "Neplatny device token." }, { status: 401 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase neni nastavene." }, { status: 503 });

  const [telemetryResult, relaysResult] = await Promise.all([
    supabase.from("solar_telemetry").select(solarTelemetryFields).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("solar_relay_states").select("relay,is_on").order("relay"),
  ]);
  if (telemetryResult.error) return NextResponse.json({ error: telemetryResult.error.message }, { status: 500 });
  if (relaysResult.error) return NextResponse.json({ error: relaysResult.error.message }, { status: 500 });

  const relays = { ...defaultSolarRelayState };
  for (const row of relaysResult.data ?? []) if (row.relay in relays) relays[row.relay as SolarRelayName] = Boolean(row.is_on);
  return NextResponse.json({ telemetry: telemetryResult.data ?? null, relays }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!validDeviceRequest(request)) return NextResponse.json({ error: "Neplatny device token." }, { status: 401 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Supabase neni nastavene." }, { status: 503 });
  let payload: { relay?: unknown; isOn?: unknown };
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Neplatne JSON." }, { status: 400 }); }
  if (typeof payload.relay !== "string" || !solarRelayNames.includes(payload.relay as SolarRelayName) || typeof payload.isOn !== "boolean") {
    return NextResponse.json({ error: "Neplatne rele nebo stav." }, { status: 400 });
  }
  const { error } = await supabase.from("solar_relay_states").upsert({ relay: payload.relay, is_on: payload.isOn });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, relay: payload.relay, isOn: payload.isOn });
}
