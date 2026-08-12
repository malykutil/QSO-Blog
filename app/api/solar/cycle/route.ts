import { NextResponse } from "next/server";

import { hasSolarControlSession } from "@/src/lib/solar-auth";
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

export async function POST() {
  if (!(await canManageSolar())) return NextResponse.json({ error: "Pro test relé se nejprve přihlaste." }, { status: 403 });
  const supabase = getSupabaseAdminClient() ?? await getSupabaseRouteClient();
  if (!supabase) return NextResponse.json({ error: "Supabase není nakonfigurovaný." }, { status: 503 });

  const { data: pending, error: pendingError } = await supabase
    .from("solar_relay_cycle_requests")
    .select("id,requested_at")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pendingError) return NextResponse.json({ error: "Nejprve spusťte databázovou migraci pro test relé." }, { status: 503 });
  if (pending) return NextResponse.json({ ok: true, pending: true, requestId: pending.id });

  const { data, error } = await supabase
    .from("solar_relay_cycle_requests")
    .insert({ status: "pending" })
    .select("id,requested_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, pending: true, requestId: data.id });
}
