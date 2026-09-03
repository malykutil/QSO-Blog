import { NextRequest, NextResponse } from "next/server";

import { isValidEmail, normalizeEmail } from "@/src/lib/qsl-data";
import { getSupabaseAdminClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.QSL_WORKER_SECRET || process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Neplatný cron token." }, { status: 401 });
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Chybí serverové databázové připojení." }, { status: 503 });
  }

  const { data: queuedItem, error } = await supabase
    .from("qsl_queue")
    .select("id,created_by,contact_email,callsign")
    .in("status", ["ready", "failed"])
    .not("approved_at", "is", null)
    .is("sent_at", null)
    .order("approved_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Frontu se nepodařilo načíst." }, { status: 502 });
  }
  if (!queuedItem) {
    return NextResponse.json({ ok: true, processed: false, message: "Fronta je prázdná." });
  }

  const email = normalizeEmail(queuedItem.contact_email ?? "");
  if (!isValidEmail(email)) {
    await supabase
      .from("qsl_queue")
      .update({ status: "missing_email", approved_at: null, error_message: "Chybí platný e-mail." })
      .eq("id", queuedItem.id);
    return NextResponse.json({ ok: true, processed: false, skipped: queuedItem.id });
  }

  const sendResponse = await fetch(new URL("/api/qsl/send", request.url), {
    method: "POST",
    headers: {
      Authorization: request.headers.get("authorization") ?? "",
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({ queueId: queuedItem.id, ownerId: queuedItem.created_by, email }),
  });
  const result = (await sendResponse.json().catch(() => null)) as {
    error?: string;
    haltBulk?: boolean;
    retryAfterSeconds?: number;
  } | null;

  if (sendResponse.status === 423 || result?.haltBulk) {
    await supabase
      .from("qsl_queue")
      .update({ approved_at: null })
      .eq("created_by", queuedItem.created_by)
      .is("sent_at", null);
  } else if (!sendResponse.ok && sendResponse.status !== 429) {
    await supabase
      .from("qsl_queue")
      .update({ approved_at: null })
      .eq("id", queuedItem.id);
  }

  return NextResponse.json(
    {
      ok: sendResponse.ok,
      processed: sendResponse.ok,
      callsign: queuedItem.callsign,
      error: result?.error,
      retryAfterSeconds: result?.retryAfterSeconds,
    },
    { status: sendResponse.ok ? 200 : sendResponse.status },
  );
}
