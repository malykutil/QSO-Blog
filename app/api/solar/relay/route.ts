import { NextRequest, NextResponse } from "next/server";

import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { solarRelayNames, type SolarRelayName } from "@/src/lib/solar-data";
import { createSolarCommand, evaluateSolarSecurity, validateSameOrigin } from "@/src/lib/solar-command-security";
import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";

async function controlIdentity() {
  if (await hasSolarControlSession()) return { allowed: true, userId: null };
  const client = await getSupabaseRouteClient();
  if (!client) return { allowed: false, userId: null };
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { allowed: false, userId: null };
  const { data: owner } = await client.from("app_owners").select("user_id").eq("user_id", user.id).maybeSingle();
  return { allowed: Boolean(owner), userId: owner ? user.id : null };
}

export async function POST(request: NextRequest) {
  if (!validateSameOrigin(request)) return NextResponse.json({ error: "Neplatný Origin." }, { status: 403 });
  const identity = await controlIdentity();
  if (!identity.allowed) return NextResponse.json({ error: "Pro ovládání se přihlas oprávněným účtem." }, { status: 403 });
  let payload: { relay?: unknown; isOn?: unknown; mode?: unknown };
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Neplatný JSON." }, { status: 400 }); }
  const relay = payload.relay;
  if (typeof relay !== "string" || !solarRelayNames.includes(relay as SolarRelayName) || typeof payload.isOn !== "boolean") {
    return NextResponse.json({ error: "Neplatné relé nebo stav." }, { status: 400 });
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Serverové řízení není nakonfigurované." }, { status: 503 });
  const [telemetryResult, relayResult] = await Promise.all([
    supabase.from("solar_telemetry").select("recorded_at,mq9_raw,mq9_alarm,remote_control_enabled,controller_fault,emergency_stop_active,battery_pair_consistent,command_auth_ready").order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("solar_relay_states").select("relay,is_on"),
  ]);
  if (telemetryResult.error || relayResult.error) return NextResponse.json({ ok: false, accepted: false, executed: false, physicallyVerified: false, reasonCode: "UNKNOWN_SAFETY_STATE" }, { status: 503 });
  const relays = Object.fromEntries((relayResult.data ?? []).map((row) => [row.relay, Boolean(row.is_on)]));
  const security = evaluateSolarSecurity(telemetryResult.data, relays);
  if (!security.canRemoteControl) {
    return NextResponse.json({ ok: false, accepted: false, executed: false, physicallyVerified: false, reasonCode: security.reasonCode, error: security.reason }, { status: 409 });
  }
  const logicalTarget = relay === "aux" || relay === "aux2" ? "battery_switch" : relay;
  try {
    const previousKnownState = logicalTarget === "battery_switch" ? Boolean(relays.aux) && Boolean(relays.aux2) : Boolean(relays[logicalTarget]);
    const created = await createSolarCommand({ supabase, request, userId: identity.userId, action: "RELAY_SET", target: logicalTarget, requestedState: payload.isOn, previousKnownState, payload: { relay: logicalTarget, isOn: payload.isOn } });
    if (!created.ok) return NextResponse.json({ ok: false, accepted: false, executed: false, physicallyVerified: false, reasonCode: created.reasonCode }, { status: created.status, headers: { "Retry-After": String(created.retryAfter) } });
    // A direct user decision owns the relay until the user explicitly puts
    // that relay back into AUTO mode. This prevents the AI controller from
    // silently overwriting a manual command on its next polling cycle.
    if (["bufik", "fan12v", "fan24v"].includes(relay)) {
      const { error: modeError } = await supabase.from("solar_relay_modes").upsert({ relay, mode: payload.isOn ? "MANUAL_ON" : "MANUAL_OFF" });
      if (modeError) throw modeError;
    }
    return NextResponse.json({ ok: true, commandId: created.commandId, accepted: false, executed: false, physicallyVerified: false, reasonCode: null, status: "REQUESTED", relay, isOn: payload.isOn, linkedRelays: logicalTarget === "battery_switch" }, { status: 202 });
  } catch (error) {
    console.error("Solar command audit insert failed", error);
    return NextResponse.json({ ok: false, accepted: false, executed: false, physicallyVerified: false, reasonCode: "AUDIT_UNAVAILABLE" }, { status: 503 });
  }
}
