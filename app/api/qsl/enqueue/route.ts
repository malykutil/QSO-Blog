import { NextResponse } from "next/server";

import { isValidEmail, normalizeEmail } from "@/src/lib/qsl-data";
import { getSupabaseRouteClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

type QueueRequest = {
  items?: Array<{ queueId?: string; email?: string }>;
};

export async function POST(request: Request) {
  const supabase = await getSupabaseRouteClient();
  if (!supabase) {
    return NextResponse.json({ error: "Databázové připojení není nakonfigurované." }, { status: 503 });
  }

  const user = (await supabase.auth.getUser()).data.user;
  if (!user) {
    return NextResponse.json({ error: "Pro zařazení QSL je potřeba přihlášení." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as QueueRequest | null;
  const requestedItems = (payload?.items ?? [])
    .slice(0, 15)
    .map((item) => ({ queueId: item.queueId ?? "", email: normalizeEmail(item.email ?? "") }))
    .filter((item) => item.queueId && isValidEmail(item.email));

  if (!requestedItems.length) {
    return NextResponse.json({ error: "Není co zařadit do fronty." }, { status: 400 });
  }

  const approvedAt = new Date().toISOString();
  let queued = 0;

  for (const item of requestedItems) {
    const { data, error } = await supabase
      .from("qsl_queue")
      .update({
        contact_email: item.email,
        status: "ready",
        approved_at: approvedAt,
        error_message: null,
      })
      .eq("id", item.queueId)
      .eq("created_by", user.id)
      .is("sent_at", null)
      .select("id")
      .maybeSingle();

    if (!error && data) queued += 1;
  }

  return NextResponse.json(
    { ok: true, queued, intervalMinutes: 10 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
