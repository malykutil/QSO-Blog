import { NextRequest, NextResponse } from "next/server";

import { MQ9_ALARM_RESET_MARKER } from "@/src/lib/mq9-alarm";
import { isMq9Critical } from "@/src/lib/mq9-air-quality";
import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { solarExtendedTelemetryFields, solarTelemetryFields } from "@/src/lib/solar-data";
import { SOLAR_MEASUREMENT_CONFIG } from "@/src/lib/solar-energy";
import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";

export const dynamic = "force-dynamic";

async function canManageSolar() {
  if (await hasSolarControlSession()) return true;
  const supabase = await getSupabaseRouteClient();
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: owner } = await supabase.from("app_owners").select("user_id").eq("user_id", user.id).maybeSingle();
  return Boolean(owner);
}

export async function POST(request: NextRequest) {
  if (!(await canManageSolar())) {
    return NextResponse.json({ error: "Pro vypnutí poplachu se nejdřív přihlas." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 403 });
  }

  const supabase = getSupabaseAdminClient() ?? await getSupabaseRouteClient();
  if (!supabase) return NextResponse.json({ error: "Supabase není nastavené." }, { status: 503 });

  const fields = `${solarTelemetryFields},${solarExtendedTelemetryFields}`;
  const { data: latest, error: latestError } = await supabase
    .from("solar_telemetry")
    .select(fields)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) return NextResponse.json({ error: latestError.message }, { status: 500 });
  if (!latest) return NextResponse.json({ error: "Chybí aktuální telemetrie." }, { status: 409 });

  const recordedAt = new Date(latest.recorded_at).getTime();
  if (!Number.isFinite(recordedAt) || Date.now() - recordedAt > SOLAR_MEASUREMENT_CONFIG.onlineAgeMs) {
    return NextResponse.json({ error: "Poplach nelze vypnout bez čerstvých dat z RPi." }, { status: 409 });
  }
  if (isMq9Critical(latest.mq9_raw)) {
    return NextResponse.json({ error: "MQ-9 stále měří kritickou hodnotu. Nejdřív zkontroluj objekt a odstraň nebezpečí." }, { status: 409 });
  }

  const resetCommand = {
    ...latest,
    recorded_at: undefined,
    mq9_alarm: false,
    mq9_alarm_trigger_raw: MQ9_ALARM_RESET_MARKER,
  };
  const { error: insertError } = await supabase.from("solar_telemetry").insert(resetCommand);
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json(
    { ok: true, pending: true, relaysRemainOff: true },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
