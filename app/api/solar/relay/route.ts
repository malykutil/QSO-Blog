import { NextRequest, NextResponse } from "next/server";

import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { solarRelayNames, type SolarRelayName } from "@/src/lib/solar-data";
import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";

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
  if (!(await canManageSolar())) return NextResponse.json({ error: "Pro ovládání se přihlas účtem KZB nebo administrátorským účtem." }, { status: 403 });
  let payload: { relay?: unknown; isOn?: unknown };
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Neplatný JSON." }, { status: 400 }); }
  const relay = payload.relay;
  if (typeof relay !== "string" || !solarRelayNames.includes(relay as SolarRelayName) || typeof payload.isOn !== "boolean") {
    return NextResponse.json({ error: "Neplatné relé nebo stav." }, { status: 400 });
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ error: "Chybí SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  const { error } = await supabase.from("solar_relay_states").upsert({ relay, is_on: payload.isOn });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, relay, isOn: payload.isOn });
}
