import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { normalizeQslQueueItem, qslQueueSelectFields } from "@/src/lib/qsl-data";
import { renderQslCardPng } from "@/src/lib/qsl-card";
import { getSupabaseRouteClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

function buildResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

export async function GET(request: Request, context: RouteContext<"/api/qsl/preview/[queueId]">) {
  const supabase = await getSupabaseRouteClient();

  if (!supabase) {
    return buildResponse({ error: "Supabase není nakonfigurovaná." }, 503);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return buildResponse({ error: "Pro zobrazení QSL je potřeba přihlášení." }, 401);
  }

  const { queueId } = await context.params;
  if (!queueId) {
    return buildResponse({ error: "Chybí identifikátor QSL." }, 400);
  }

  const { data, error } = await supabase
    .from("qsl_queue")
    .select(qslQueueSelectFields)
    .eq("id", queueId)
    .eq("created_by", user.id)
    .maybeSingle();

  if (error || !data) {
    return buildResponse({ error: "QSL záznam se nepodařilo načíst." }, 404);
  }

  const item = normalizeQslQueueItem(data);
  const shouldDownload = new URL(request.url).searchParams.get("download") === "1";
  const template = await readFile(join(process.cwd(), "public", "qsl-template.png"));
  const png = await renderQslCardPng(template, {
    callsign: item.callsign,
    qsoDate: item.qsoDate,
    timeOn: item.timeOn,
    band: item.band,
    mode: item.mode,
    rstSent: item.rstSent,
    rstRcvd: item.rstRcvd,
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="QSL-OK2MKJ-${item.callsign || "preview"}.png"`,
    },
  });
}
