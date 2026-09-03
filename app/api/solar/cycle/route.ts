import { NextRequest, NextResponse } from "next/server";

import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { createSolarCommand, evaluateSolarSecurity, validateSameOrigin } from "@/src/lib/solar-command-security";
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
  if (!actor.allowed) return NextResponse.json({ error: "Pro test relé se přihlas oprávněným účtem." }, { status: 403 });
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Serverové řízení není nakonfigurované." }, { status: 503 });
  const [telemetry, relayRows] = await Promise.all([
    supabase.from("solar_telemetry").select("recorded_at,mq9_raw,mq9_alarm,remote_control_enabled,controller_fault,emergency_stop_active,battery_pair_consistent,command_auth_ready").order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("solar_relay_states").select("relay,is_on"),
  ]);
  const security = evaluateSolarSecurity(telemetry.data, Object.fromEntries((relayRows.data ?? []).map((row) => [row.relay, Boolean(row.is_on)])));
  if (telemetry.error || relayRows.error || !security.canRemoteControl) return NextResponse.json({ ok: false, accepted: false, executed: false, physicallyVerified: false, reasonCode: security.reasonCode ?? "UNKNOWN_SAFETY_STATE" }, { status: 409 });
  try {
    const created = await createSolarCommand({ supabase, request, userId: actor.userId, action: "RELAY_CYCLE", target: "relay_cycle" });
    if (!created.ok) return NextResponse.json({ ok: false, reasonCode: created.reasonCode }, { status: created.status, headers: { "Retry-After": String(created.retryAfter) } });
    return NextResponse.json({ ok: true, pending: true, requestId: created.commandId, commandId: created.commandId, accepted: false, executed: false, physicallyVerified: false, status: "REQUESTED" }, { status: 202 });
  } catch (error) {
    console.error("Solar cycle audit insert failed", error);
    return NextResponse.json({ ok: false, reasonCode: "AUDIT_UNAVAILABLE" }, { status: 503 });
  }
}
