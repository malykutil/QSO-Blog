import { NextRequest, NextResponse } from "next/server";

import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { isMq9Critical } from "@/src/lib/mq9-air-quality";
import { createSolarCommand, evaluateSolarSecurity, validateSameOrigin } from "@/src/lib/solar-command-security";
import { SOLAR_MEASUREMENT_CONFIG } from "@/src/lib/solar-energy";
import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";

async function identity() {
  if (await hasSolarControlSession()) return { allowed: true, userId: null };
  const client = await getSupabaseRouteClient();
  const { data: { user } } = client ? await client.auth.getUser() : { data: { user: null } };
  if (!client || !user) return { allowed: false, userId: null };
  const { data: owner } = await client.from("app_owners").select("user_id").eq("user_id", user.id).maybeSingle();
  return { allowed: Boolean(owner), userId: owner ? user.id : null };
}

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) return NextResponse.json({ error: "Neplatný Origin." }, { status: 403 });
  const actor = await identity();
  if (!actor.allowed) return NextResponse.json({ error: "Pro reset alarmu se přihlas oprávněným účtem." }, { status: 403 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Serverové řízení není nakonfigurované." }, { status: 503 });
  const [telemetryResult, relayResult] = await Promise.all([
    supabase.from("solar_telemetry").select("recorded_at,mq9_raw,mq9_alarm,remote_control_enabled,controller_fault,emergency_stop_active,battery_pair_consistent,command_auth_ready").order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("solar_relay_states").select("relay,is_on"),
  ]);
  const latest = telemetryResult.data;
  if (telemetryResult.error || relayResult.error || !latest) return NextResponse.json({ ok: false, reasonCode: "UNKNOWN_SAFETY_STATE" }, { status: 409 });
  const age = Date.now() - new Date(latest.recorded_at).getTime();
  if (!Number.isFinite(age) || age > SOLAR_MEASUREMENT_CONFIG.delayedAgeMs) return NextResponse.json({ ok: false, reasonCode: "STALE_TELEMETRY" }, { status: 409 });
  if (isMq9Critical(latest.mq9_raw)) return NextResponse.json({ ok: false, reasonCode: "MQ9_CRITICAL", error: "MQ-9 stále měří kritickou hodnotu." }, { status: 409 });
  const relays = Object.fromEntries((relayResult.data ?? []).map((row) => [row.relay, Boolean(row.is_on)]));
  const security = evaluateSolarSecurity(latest, relays, { allowAlarmReset: true });
  if (!security.canRemoteControl) return NextResponse.json({ ok: false, reasonCode: security.reasonCode, error: security.reason }, { status: 409 });
  try {
    const created = await createSolarCommand({ supabase, request, userId: actor.userId, action: "ALARM_RESET", target: "mq9_alarm", payload: { physicalInspectionConfirmed: true } });
    if (!created.ok) return NextResponse.json({ ok: false, reasonCode: created.reasonCode }, { status: created.status, headers: { "Retry-After": String(created.retryAfter) } });
    return NextResponse.json({ ok: true, pending: true, relaysRemainOff: true, commandId: created.commandId, accepted: false, executed: false, physicallyVerified: false, status: "REQUESTED" }, { status: 202 });
  } catch (auditError) {
    console.error("Solar alarm reset audit insert failed", auditError);
    return NextResponse.json({ ok: false, reasonCode: "AUDIT_UNAVAILABLE" }, { status: 503 });
  }
}
