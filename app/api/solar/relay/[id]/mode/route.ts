import { NextRequest, NextResponse } from "next/server";

import { canManageSolarControl } from "@/src/lib/solar-control-access";
import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";

const allowedRelays = ["bufik", "fan12v", "fan24v"] as const;
const modes = ["MANUAL_OFF", "AUTO", "MANUAL_ON"] as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageSolarControl())) return NextResponse.json({ error: "Ovládání vyžaduje oprávněné přihlášení." }, { status: 403 });
  const { id } = await params;
  if (!allowedRelays.includes(id as typeof allowedRelays[number])) return NextResponse.json({ error: "Toto relé nepodporuje AUTO režim." }, { status: 400 });
  const body = await request.json().catch(() => null) as { mode?: unknown } | null;
  if (!body || !modes.includes(body.mode as typeof modes[number])) return NextResponse.json({ error: "Neplatný režim." }, { status: 400 });
  const supabase = getSupabaseAdminClient() ?? await getSupabaseRouteClient();
  if (!supabase) return NextResponse.json({ error: "Supabase není nakonfigurovaný." }, { status: 503 });
  const { error } = await supabase.from("solar_relay_modes").upsert({ relay: id, mode: body.mode });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, relay: id, mode: body.mode });
}
