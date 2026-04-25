import { NextRequest, NextResponse } from "next/server";

import { fetchHamqthEmail, type HamqthCredentials } from "@/src/lib/hamqth";
import { normalizeQslQueueItem, qslQueueSelectFields } from "@/src/lib/qsl-data";
import { getSupabaseRouteClient } from "@/src/lib/supabase-server";

function buildResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseRouteClient();

  if (!supabase) {
    return buildResponse({ error: "Supabase není nakonfigurovaný." }, 503);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return buildResponse({ error: "Pro dohledání QSL kontaktu je potřeba přihlášení." }, 401);
  }

  const payload = (await request.json().catch(() => null)) as {
    queueId?: string;
    hamqth?: Partial<HamqthCredentials>;
  } | null;
  const queueId = payload?.queueId ?? "";

  if (!queueId) {
    return buildResponse({ error: "Chybí QSL záznam." }, 400);
  }

  const { data, error } = await supabase
    .from("qsl_queue")
    .select(qslQueueSelectFields)
    .eq("id", queueId)
    .eq("created_by", user.id)
    .single();

  if (error || !data) {
    return buildResponse({ error: "QSL záznam se nepodařilo načíst." }, 404);
  }

  const item = normalizeQslQueueItem(data);

  if (item.status === "sent") {
    return buildResponse({ error: "Tenhle QSL lístek už byl odeslán." }, 409);
  }

  try {
    const email = await fetchHamqthEmail(item.callsign, payload?.hamqth);

    await supabase.from("qsl_contacts").insert({
      created_by: user.id,
      callsign: item.callsign.toUpperCase(),
      email,
      source: "hamqth",
      is_verified: false,
    });

    await supabase
      .from("qsl_queue")
      .update({
        contact_email: email,
        status: "ready",
        error_message: null,
      })
      .eq("id", item.id)
      .eq("created_by", user.id);

    return buildResponse({ email, source: "hamqth" }, 200);
  } catch (error) {
    return buildResponse(
      { error: error instanceof Error ? error.message : "E-mail se nepodařilo dohledat." },
      502,
    );
  }
}
