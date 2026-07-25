import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/src/lib/supabase-server";
import { defaultSolarRelayState, solarTelemetryFields, type SolarRelayName } from "@/src/lib/solar-data";

export const dynamic = "force-dynamic";

export async function GET() {
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
