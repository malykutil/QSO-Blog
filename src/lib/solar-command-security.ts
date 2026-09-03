import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { isMq9Critical } from "@/src/lib/mq9-air-quality";
import { SOLAR_MEASUREMENT_CONFIG } from "@/src/lib/solar-energy";

export const SOLAR_COMMAND_TTL_SECONDS = 20;
export const SOLAR_COMMAND_FUTURE_TOLERANCE_SECONDS = 5;
export const SOLAR_COMMAND_PATH = "/api/solar/device/command";
// Manual control must be responsive. Anti-cycling for AI is enforced locally
// on the controller; the server only suppresses accidental duplicate clicks.
export const SOLAR_CONTROL_MIN_INTERVAL_SECONDS = 2;

export type SolarCommandAction = "RELAY_SET" | "RELAY_CYCLE" | "ALARM_RESET";
export type SolarCommandStatus =
  | "REQUESTED"
  | "ACCEPTED_BY_RPI"
  | "EXECUTED_BY_CONTROLLER"
  | "REJECTED"
  | "EXPIRED"
  | "DUPLICATE"
  | "FAILED"
  | "SAFETY_BLOCKED"
  | "CONTROLLER_OFFLINE";

export type SolarSecurityStatus = {
  canRemoteControl: boolean;
  reasonCode: string | null;
  reason: string;
  telemetryFresh: boolean;
  controllerOnline: boolean;
  safetyControllerOk: boolean;
  emergencyStopClear: boolean;
  batteryPairConsistent: boolean;
  commandAuthenticationConfigured: boolean;
  localRemoteControlEnabled: boolean;
};

export function validateSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

export function readRequestIdentity(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    sourceIp: forwarded || request.headers.get("x-real-ip") || null,
    userAgent: request.headers.get("user-agent"),
  };
}

export function evaluateSolarSecurity(
  telemetry: Record<string, unknown> | null,
  relays: Record<string, boolean>,
  options: { allowAlarmReset?: boolean } = {},
): SolarSecurityStatus {
  const secretConfigured = Boolean(process.env.SOLAR_COMMAND_HMAC_SECRET);
  if (!telemetry) return deny("UNKNOWN_SAFETY_STATE", "Chybí telemetrie; neznámý stav není bezpečný.", secretConfigured);
  const recorded = new Date(String(telemetry.recorded_at ?? "")).getTime();
  const telemetryAge = Date.now() - recorded;
  const telemetryFresh = Number.isFinite(recorded) && telemetryAge >= -5_000 && telemetryAge <= SOLAR_MEASUREMENT_CONFIG.delayedAgeMs;
  if (!telemetryFresh) return deny("STALE_TELEMETRY", "Telemetrie je starší než 5 minut.", secretConfigured);
  if (telemetry.remote_control_enabled !== true) return deny("REMOTE_CONTROL_DISABLED", "Lokální kill switch na RPi není zapnutý nebo jeho stav není znám.", secretConfigured);
  if (telemetry.command_auth_ready !== true) return deny("COMMAND_AUTH_UNAVAILABLE", "RPi nepotvrdilo dostupnost HMAC autentizace příkazů.", secretConfigured);
  if (telemetry.controller_fault !== false) return deny("CONTROLLER_FAULT", "Safety controller hlásí poruchu nebo neznámý stav.", secretConfigured);
  if (!options.allowAlarmReset && telemetry.emergency_stop_active !== false) return deny("EMERGENCY_STOP", "Emergency stop je aktivní nebo jeho stav není znám.", secretConfigured, true);
  if ((!options.allowAlarmReset && telemetry.mq9_alarm === true) || isMq9Critical(typeof telemetry.mq9_raw === "number" ? telemetry.mq9_raw : null)) {
    return deny("MQ9_CRITICAL", "Aktivní MQ-9 alarm blokuje vzdálené ovládání.", secretConfigured, true);
  }
  if (telemetry.battery_pair_consistent !== true || Boolean(relays.aux) !== Boolean(relays.aux2)) {
    return deny("BATTERY_RELAY_MISMATCH", "Softwarový stav bateriového páru není konzistentní.", secretConfigured);
  }
  if (!secretConfigured) return deny("COMMAND_AUTH_UNCONFIGURED", "Chybí HMAC secret pro podepisování příkazů.", false);
  return {
    canRemoteControl: true,
    reasonCode: null,
    reason: "Lokální controller může příkaz ještě odmítnout podle aktuální safety policy.",
    telemetryFresh: true,
    controllerOnline: true,
    safetyControllerOk: true,
    emergencyStopClear: true,
    batteryPairConsistent: true,
    commandAuthenticationConfigured: true,
    localRemoteControlEnabled: true,
  };
}

function deny(reasonCode: string, reason: string, secretConfigured: boolean, emergencyActive = false): SolarSecurityStatus {
  return {
    canRemoteControl: false,
    reasonCode,
    reason,
    telemetryFresh: reasonCode !== "STALE_TELEMETRY" && reasonCode !== "UNKNOWN_SAFETY_STATE",
    controllerOnline: reasonCode !== "STALE_TELEMETRY" && reasonCode !== "UNKNOWN_SAFETY_STATE",
    safetyControllerOk: false,
    emergencyStopClear: !emergencyActive,
    batteryPairConsistent: reasonCode !== "BATTERY_RELAY_MISMATCH",
    commandAuthenticationConfigured: secretConfigured,
    localRemoteControlEnabled: reasonCode !== "REMOTE_CONTROL_DISABLED" && reasonCode !== "UNKNOWN_SAFETY_STATE" && reasonCode !== "STALE_TELEMETRY",
  };
}

export function signSolarCommand(command: Record<string, unknown>) {
  const secret = process.env.SOLAR_COMMAND_HMAC_SECRET;
  if (!secret) throw new Error("SOLAR_COMMAND_HMAC_SECRET is not configured");
  const requestedAt = new Date(String(command.request_timestamp ?? "")).getTime();
  if (!Number.isFinite(requestedAt)) throw new Error("Command request timestamp is invalid");
  const timestamp = Math.floor(requestedAt / 1000);
  const nonce = randomBytes(18).toString("base64url");
  const commandId = String(command.id);
  const body = JSON.stringify(command);
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = ["POST", SOLAR_COMMAND_PATH, timestamp, nonce, commandId, bodyHash].join("\n");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return { method: "POST", path: SOLAR_COMMAND_PATH, timestamp, nonce, commandId, body, signature, expiresInSeconds: SOLAR_COMMAND_TTL_SECONDS };
}

export async function createSolarCommand(args: {
  supabase: SupabaseClient;
  request: NextRequest;
  userId: string | null;
  action: SolarCommandAction;
  target: string;
  requestedState?: boolean | null;
  previousKnownState?: boolean | null;
  payload?: Record<string, unknown>;
}) {
  const { supabase, request, userId, action, target } = args;
  const identity = readRequestIdentity(request);
  const commandId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SOLAR_COMMAND_TTL_SECONDS * 1000).toISOString();

  const { data: recent } = await supabase
    .from("solar_control_commands")
    .select("created_at,requested_state,status")
    .eq("target", target)
    .gte("created_at", new Date(now.getTime() - SOLAR_CONTROL_MIN_INTERVAL_SECONDS * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent && recent.requested_state === (args.requestedState ?? null)) {
    return { ok: false as const, status: 429, retryAfter: SOLAR_CONTROL_MIN_INTERVAL_SECONDS, reasonCode: "RATE_LIMIT" };
  }

  const row = {
    id: commandId,
    status: "REQUESTED",
    action,
    target,
    requested_state: args.requestedState ?? null,
    previous_known_state: args.previousKnownState ?? null,
    payload: args.payload ?? {},
    user_id: userId,
    source_ip: identity.sourceIp,
    user_agent: identity.userAgent,
    request_timestamp: now.toISOString(),
    expires_at: expiresAt,
    physically_verified: false,
  };
  const { error } = await supabase.from("solar_control_commands").insert(row);
  if (error) throw error;
  return { ok: true as const, commandId, expiresAt };
}
