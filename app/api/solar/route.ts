import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";
import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { defaultSolarRelayState, solarExtendedTelemetryFields, solarTelemetryFields, type SolarTelemetry } from "@/src/lib/solar-data";
import { analyzeSolarEnergy, enrichSolarTelemetry, sanitizeCurrentFields, sanitizeTemperatureFields } from "@/src/lib/solar-energy";
import { isMq9AlarmResetMarker } from "@/src/lib/mq9-alarm";
import { evaluateSolarSecurity } from "@/src/lib/solar-command-security";

export const dynamic = "force-dynamic";

const legacySolarTelemetryFields =
  "solar1_voltage,solar2_voltage,solar1_power,solar2_power,load_power,solar_energy_today_wh,load_energy_today_wh,battery_voltage,solar1_current,solar2_current,battery_current,rpi_cpu_temperature,object_temperature,object_humidity,battery_temperature,outside_temperature,outside_humidity,outside_pressure,mq9_raw,mq9_voltage,mppt_temperature,recorded_at";

const extendedArduinoFields = [
  "arduino_uptime_ms",
  "battery_pressure",
  "ina219_current",
  "ina219_power",
  "ina219_shunt_voltage_mv",
  "acs1_raw",
  "acs1_voltage",
  "acs2_raw",
  "acs2_voltage",
  "acs3_raw",
  "acs3_voltage",
  "mq9_alarm_trigger_raw",
] as const;

const controllerBooleanFields = ["remote_control_enabled", "controller_fault", "emergency_stop_active", "battery_pair_consistent", "command_auth_ready"] as const;
const extendedTelemetryFields = [...extendedArduinoFields, "mq9_alarm", ...controllerBooleanFields] as const;

async function fetchTelemetryHistory(supabase: SupabaseClient, fields: string, since: string) {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];

  for (let offset = 0; offset < 50000; offset += pageSize) {
    const { data, error } = await supabase
      .from("solar_telemetry")
      .select(fields)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) return { data: rows, error };
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return { data: rows, error: null };
}

function validRpiRequest(request: NextRequest) {
  const token = process.env.SOLAR_RPI_TOKEN;
  return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return representedAsUtc - date.getTime();
}

function getLocalDayStartIso(timeZone = process.env.SOLAR_TIMEZONE ?? "Europe/Prague") {
  const now = new Date();
  const dayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(dayParts.map((part) => [part.type, part.value]));
  const approximateUtcMidnight = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  return new Date(approximateUtcMidnight.getTime() - getTimeZoneOffsetMs(approximateUtcMidnight, timeZone)).toISOString();
}

async function canManageSolar() {
  if (await hasSolarControlSession()) return true;
  const supabase = await getSupabaseRouteClient();
  if (!supabase) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: owner } = await supabase.from("app_owners").select("user_id").eq("user_id", user.id).maybeSingle();
  return Boolean(owner);
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseRouteClient());
  if (!supabase) return NextResponse.json({ error: "Supabase není nastavené." }, { status: 503 });

  const range = request.nextUrl.searchParams.get("range") ?? "24h";
  const latestOnly = request.nextUrl.searchParams.get("latest") === "1";
  const rangeHours = range === "1h" ? 1 : range === "6h" ? 6 : range === "2d" ? 24 * 2 : range === "7d" ? 24 * 7 : range === "30d" ? 24 * 30 : 24;
  const since = new Date(Date.now() - rangeHours * 60 * 60 * 1000).toISOString();
  const todaySince = getLocalDayStartIso();

  const [latestResult, extendedLatestResult, historyResult, todayResult, relaysResult, cycleResult, relayEventsResult, autoSettingsResult, relayModesResult, commandResult] = await Promise.all([
    supabase.from("solar_telemetry").select(solarTelemetryFields).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("solar_telemetry").select(solarExtendedTelemetryFields).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    latestOnly ? Promise.resolve({ data: [], error: null }) : fetchTelemetryHistory(supabase, solarTelemetryFields, since),
    fetchTelemetryHistory(supabase, solarTelemetryFields, todaySince),
    supabase.from("solar_relay_states").select("relay,is_on,updated_at").order("relay"),
    supabase.from("solar_relay_cycle_requests").select("id,requested_at").eq("status", "pending").order("requested_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("solar_relay_cycle_requests").select("id,requested_at,completed_at").eq("status", "completed").order("completed_at", { ascending: false }).limit(6),
    supabase.from("solar_auto_settings").select("enabled").eq("id", 1).maybeSingle(),
    supabase.from("solar_relay_modes").select("relay,mode"),
    supabase.from("solar_control_commands").select("id,status,action,target,requested_state,reason_code,reason,created_at,completed_at,physically_verified").order("created_at", { ascending: false }).limit(10),
  ]);
  let telemetry: Record<string, unknown> | null = latestResult.data as Record<string, unknown> | null;
  let history: Record<string, unknown>[] = (historyResult.data ?? []) as Record<string, unknown>[];
  let todayHistory: Record<string, unknown>[] = (todayResult.data ?? []) as Record<string, unknown>[];
  if (latestResult.error || historyResult.error || todayResult.error) {
    const [legacyLatest, legacyHistory, legacyTodayHistory] = await Promise.all([
      supabase.from("solar_telemetry").select(legacySolarTelemetryFields).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
      fetchTelemetryHistory(supabase, legacySolarTelemetryFields, since),
      fetchTelemetryHistory(supabase, legacySolarTelemetryFields, todaySince),
    ]);
    telemetry = legacyLatest.data as Record<string, unknown> | null;
    history = (legacyHistory.data ?? []) as Record<string, unknown>[];
    todayHistory = (legacyTodayHistory.data ?? []) as Record<string, unknown>[];
  }
  if (!extendedLatestResult.error && extendedLatestResult.data && telemetry) {
    telemetry = { ...telemetry, ...extendedLatestResult.data };
  }
  const rangeAnalysis = analyzeSolarEnergy(history as unknown as SolarTelemetry[]);
  const todayAnalysis = analyzeSolarEnergy(todayHistory as unknown as SolarTelemetry[]);
  const enrichedTelemetry = telemetry ? enrichSolarTelemetry(telemetry as unknown as SolarTelemetry) : null;
  const commands = commandResult.error ? [] : commandResult.data ?? [];
  const activeCommandStatuses = new Set(["REQUESTED", "ACCEPTED_BY_RPI"]);
  const signedAlarmResetPending = commands.some((command) => command.action === "ALARM_RESET" && activeCommandStatuses.has(command.status));
  const signedRelayCyclePending = commands.some((command) => command.action === "RELAY_CYCLE" && activeCommandStatuses.has(command.status));
  const alarmResetPending = signedAlarmResetPending || isMq9AlarmResetMarker(
    telemetry?.mq9_alarm as boolean | null | undefined,
    telemetry?.mq9_alarm_trigger_raw as number | null | undefined,
  );
  const relayState = { ...defaultSolarRelayState };
  for (const row of relaysResult.data ?? []) if (row.relay in relayState) relayState[row.relay as keyof typeof relayState] = Boolean(row.is_on);
  const security = evaluateSolarSecurity(telemetry, relayState);
  const authenticatedControl = await canManageSolar();
  return NextResponse.json(
    {
      telemetry: enrichedTelemetry,
      history: rangeAnalysis.history,
      energySummary: todayAnalysis.summary,
      relays: relayState,
      autoEnergyEnabled: autoSettingsResult.data?.enabled === true,
      relayModes: Object.fromEntries((relayModesResult.data ?? []).map((row) => [row.relay, row.mode])),
      alarmActive: alarmResetPending || Boolean(telemetry?.mq9_alarm),
      alarmResetPending,
      relayUpdatedAt: Object.fromEntries((relaysResult.data ?? []).map((row) => [row.relay, row.updated_at])),
      relayEvents: relayEventsResult.error ? [] : (relayEventsResult.data ?? []).map((event) => ({ id: event.id, occurredAt: event.completed_at ?? event.requested_at, label: "Proběhl bezpečnostní reset" })),
      canControl: authenticatedControl && security.canRemoteControl,
      canViewControls: authenticatedControl,
      security,
      commands,
      relayCyclePending: signedRelayCyclePending || (!cycleResult.error && Boolean(cycleResult.data)),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(request: NextRequest) {
  if (!validRpiRequest(request)) return NextResponse.json({ error: "Neplatný RPi token." }, { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Neplatný JSON." }, { status: 400 }); }
  const allowed = ["solar1_voltage", "solar2_voltage", "battery_voltage", "solar1_current", "solar2_current", "battery_current", "solar1_power", "solar2_power", "load_power", "solar_energy_today_wh", "load_energy_today_wh", "rpi_cpu_temperature", "object_temperature", "object_humidity", "battery_temperature", "outside_temperature", "outside_humidity", "outside_pressure", "mq9_raw", "mq9_voltage", "mppt_temperature", ...extendedArduinoFields];
  const values = Object.fromEntries(allowed.filter((key) => typeof payload[key] === "number" && Number.isFinite(payload[key])).map((key) => [key, payload[key]]));
  for (const key of ["mq9_alarm", ...controllerBooleanFields]) if (typeof payload[key] === "boolean") values[key] = payload[key];
  const supabase = getSupabaseAdminClient() ?? (await getSupabaseRouteClient());
  if (!supabase) return NextResponse.json({ error: "Supabase nenastaveno." }, { status: 503 });
  const latestResult = await supabase.from("solar_telemetry").select("rpi_cpu_temperature,object_temperature,battery_temperature,outside_temperature,mppt_temperature").order("recorded_at", { ascending: false }).limit(1).maybeSingle();
  const sanitizedPrevious = latestResult.data
    ? sanitizeTemperatureFields(latestResult.data as Record<string, unknown>)
    : null;
  const sanitizedValues = sanitizeTemperatureFields(values, sanitizedPrevious);
  for (const key of Object.keys(values)) if (!(key in sanitizedValues)) delete values[key];
  const sanitizedCurrentValues = sanitizeCurrentFields(values);
  for (const key of Object.keys(values)) if (!(key in sanitizedCurrentValues)) delete values[key];
  if (Object.keys(values).length === 0) return NextResponse.json({ error: "Chybí číselná telemetrie." }, { status: 400 });
  let { error } = await supabase.from("solar_telemetry").insert(values);
  // Keep telemetry flowing on installations where the optional BME280
  // column has not been migrated yet; the migration file adds it safely.
  if (error && error.message.includes("outside_humidity")) {
    const withoutOutsideHumidity = Object.fromEntries(Object.entries(values).filter(([key]) => key !== "outside_humidity"));
    ({ error } = await supabase.from("solar_telemetry").insert(withoutOutsideHumidity));
  }
  if (error && extendedTelemetryFields.some((key) => key in values)) {
    const legacyValues = Object.fromEntries(Object.entries(values).filter(([key]) => !extendedTelemetryFields.includes(key as typeof extendedTelemetryFields[number])));
    ({ error } = await supabase.from("solar_telemetry").insert(legacyValues));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
