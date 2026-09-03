import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";
import { defaultSolarRelayState, solarRelayNames, solarTelemetryFields, type SolarRelayName } from "@/src/lib/solar-data";
import { signSolarCommand } from "@/src/lib/solar-command-security";

export const dynamic = "force-dynamic";

// Production databases created before BME280 support do not have this optional
// column yet. Keep device polling working until the migration is applied.
const legacyDeviceTelemetryFields = solarTelemetryFields
  .replace(",outside_humidity", "")
  .replace(",remote_control_enabled,controller_fault,emergency_stop_active,battery_pair_consistent,command_auth_ready", "");

function validDeviceRequest(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const validTokens = [process.env.SOLAR_DEVICE_TOKEN, process.env.SOLAR_RPI_TOKEN].filter(Boolean).map((token) => `Bearer ${token}`);
  return Boolean(authorization && validTokens.includes(authorization));
}

export async function GET(request: NextRequest) {
  if (!validDeviceRequest(request)) return NextResponse.json({ error: "Neplatny device token." }, { status: 401 });
  const supabase = getSupabaseAdminClient() ?? await getSupabaseRouteClient();
  if (!supabase) return NextResponse.json({ error: "Supabase neni nastavene." }, { status: 503 });

  let telemetryResult = await supabase.from("solar_telemetry").select(`${solarTelemetryFields},mq9_alarm,mq9_alarm_trigger_raw`).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  if (telemetryResult.error && ["outside_humidity", "remote_control_enabled", "controller_fault", "emergency_stop_active", "battery_pair_consistent", "command_auth_ready"].some((field) => telemetryResult.error?.message.includes(field))) {
    telemetryResult = await supabase.from("solar_telemetry").select(`${legacyDeviceTelemetryFields},mq9_alarm,mq9_alarm_trigger_raw`).order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  }
  const [relaysResult, autoSettingsResult, relayModesResult] = await Promise.all([
    supabase.from("solar_relay_states").select("relay,is_on").order("relay"),
    supabase.from("solar_auto_settings").select("enabled").eq("id", 1).maybeSingle(),
    supabase.from("solar_relay_modes").select("relay,mode"),
  ]);
  if (telemetryResult.error) return NextResponse.json({ error: telemetryResult.error.message }, { status: 500 });
  if (relaysResult.error) return NextResponse.json({ error: relaysResult.error.message }, { status: 500 });

  const relays = { ...defaultSolarRelayState };
  for (const row of relaysResult.data ?? []) if (row.relay in relays) relays[row.relay as SolarRelayName] = Boolean(row.is_on);
  let command = null;
  const { data: pendingCommand } = await supabase.from("solar_control_commands").select("id,action,target,requested_state,payload,request_timestamp,expires_at,status").in("status", ["REQUESTED", "ACCEPTED_BY_RPI"]).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (pendingCommand) {
    if (new Date(pendingCommand.expires_at).getTime() <= Date.now()) {
      const terminalStatus = pendingCommand.status === "ACCEPTED_BY_RPI" ? "CONTROLLER_OFFLINE" : "EXPIRED";
      await supabase.from("solar_control_commands").update({ status: terminalStatus, reason_code: terminalStatus, reason: pendingCommand.status === "ACCEPTED_BY_RPI" ? "RPi accepted the command but no terminal acknowledgement arrived before expiry." : "Command was not delivered before its expiry.", completed_at: new Date().toISOString() }).eq("id", pendingCommand.id).eq("status", pendingCommand.status);
    } else if (pendingCommand.status === "REQUESTED") {
      command = signSolarCommand(pendingCommand);
    }
  }
  return NextResponse.json({
    telemetry: telemetryResult.data ?? null,
    relays,
    relayCycleRequest: null,
    command,
    autoEnergyEnabled: !autoSettingsResult.error && autoSettingsResult.data?.enabled === true,
    relayModes: relayModesResult.error ? {} : Object.fromEntries((relayModesResult.data ?? []).map((row) => [row.relay, row.mode])),
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!validDeviceRequest(request)) return NextResponse.json({ error: "Neplatny device token." }, { status: 401 });
  const supabase = getSupabaseAdminClient() ?? await getSupabaseRouteClient();
  if (!supabase) return NextResponse.json({ error: "Supabase neni nastavene." }, { status: 503 });
  let payload: { relay?: unknown; isOn?: unknown; emergencyStop?: unknown; relayCycleComplete?: unknown; securityReset?: unknown; commandAck?: unknown };
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Neplatne JSON." }, { status: 400 }); }
  if (payload.commandAck && typeof payload.commandAck === "object") {
    const ack = payload.commandAck as Record<string, unknown>;
    const commandId = typeof ack.commandId === "string" ? ack.commandId : "";
    const allowedStatuses = ["ACCEPTED_BY_RPI", "EXECUTED_BY_CONTROLLER", "REJECTED", "EXPIRED", "DUPLICATE", "FAILED", "SAFETY_BLOCKED"];
    const status = typeof ack.status === "string" && allowedStatuses.includes(ack.status) ? ack.status : null;
    if (!commandId || !status) return NextResponse.json({ error: "Neplatne potvrzeni prikazu." }, { status: 400 });
    const { data: command } = await supabase.from("solar_control_commands").select("id,action,target,requested_state,status").eq("id", commandId).maybeSingle();
    if (!command) return NextResponse.json({ error: "Prikaz neexistuje." }, { status: 404 });
    const terminal = status !== "ACCEPTED_BY_RPI";
    const { error: ackError } = await supabase.from("solar_control_commands").update({ status, reason_code: typeof ack.reasonCode === "string" ? ack.reasonCode : null, reason: typeof ack.reason === "string" ? ack.reason : null, rpi_response: ack, physically_verified: false, completed_at: terminal ? new Date().toISOString() : null }).eq("id", commandId);
    if (ackError) return NextResponse.json({ error: ackError.message }, { status: 500 });
    if (status === "EXECUTED_BY_CONTROLLER" && command.action === "RELAY_SET" && typeof command.requested_state === "boolean") {
      const updates = command.target === "battery_switch"
        ? [{ relay: "aux", is_on: command.requested_state }, { relay: "aux2", is_on: command.requested_state }]
        : [{ relay: command.target, is_on: command.requested_state }];
      await supabase.from("solar_relay_states").upsert(updates);
    }
    return NextResponse.json({ ok: true, commandId, status, physicallyVerified: false });
  }
  if (payload.emergencyStop === true) {
    const rows = solarRelayNames.map((relay) => ({ relay, is_on: false }));
    const { error } = await supabase.from("solar_relay_states").upsert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, emergencyStop: true, relays: defaultSolarRelayState });
  }
  if (payload.securityReset === true) {
    const rows = solarRelayNames.map((relay) => ({ relay, is_on: false }));
    const { error: relayError } = await supabase.from("solar_relay_states").upsert(rows);
    if (relayError) return NextResponse.json({ error: relayError.message }, { status: 500 });
    const { data: event, error: eventError } = await supabase.from("solar_relay_cycle_requests").insert({ status: "pending" }).select("id,requested_at").single();
    if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
    await supabase.from("solar_relay_cycle_requests").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", event.id);
    return NextResponse.json({ ok: true, securityReset: true, relays: defaultSolarRelayState, event });
  }
  if (typeof payload.relayCycleComplete === "number" && Number.isInteger(payload.relayCycleComplete)) {
    const { error } = await supabase.from("solar_relay_cycle_requests").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", payload.relayCycleComplete).eq("status", "pending");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, relayCycleComplete: payload.relayCycleComplete });
  }
  if (typeof payload.relay !== "string" || !solarRelayNames.includes(payload.relay as SolarRelayName) || typeof payload.isOn !== "boolean") {
    return NextResponse.json({ error: "Neplatne rele nebo stav." }, { status: 400 });
  }
  const { error } = await supabase.from("solar_relay_states").upsert({ relay: payload.relay, is_on: payload.isOn });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, relay: payload.relay, isOn: payload.isOn });
}
