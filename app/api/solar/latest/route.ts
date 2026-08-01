import { NextResponse } from "next/server";

import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";
import { defaultSolarRelayState, type SolarRelayName } from "@/src/lib/solar-data";

export const dynamic = "force-dynamic";

const latestTelemetryFields = "battery_voltage,solar1_current,solar2_current,battery_current,rpi_cpu_temperature,object_temperature,object_humidity,battery_temperature,mppt_temperature,recorded_at";

export async function GET() {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseRouteClient());
  if (!supabase) return NextResponse.json({ error: "Supabase neni nastavene." }, { status: 503 });

  const [telemetryResult, relaysResult] = await Promise.all([
    supabase.from("solar_telemetry").select(latestTelemetryFields).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("solar_relay_states").select("relay,is_on").order("relay"),
  ]);
  if (telemetryResult.error) return NextResponse.json({ error: telemetryResult.error.message }, { status: 500 });
  if (relaysResult.error) return NextResponse.json({ error: relaysResult.error.message }, { status: 500 });

  const relays = { ...defaultSolarRelayState };
  for (const row of relaysResult.data ?? []) if (row.relay in relays) relays[row.relay as SolarRelayName] = Boolean(row.is_on);
  return NextResponse.json({ telemetry: telemetryResult.data ?? null, relays }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
