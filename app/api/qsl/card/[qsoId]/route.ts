import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { normalizeQsoRecord, qsoSelectFields } from "@/src/lib/qso-data";
import { renderQslCardPng } from "@/src/lib/qsl-card";
import { getSupabaseRouteClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

function buildResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function GET(_request: Request, context: RouteContext<"/api/qsl/card/[qsoId]">) {
  const supabase = await getSupabaseRouteClient();

  if (!supabase) {
    return buildResponse({ error: "Supabase není nakonfigurovaná." }, 503);
  }

  const { qsoId } = await context.params;

  if (!qsoId) {
    return buildResponse({ error: "Chybí identifikátor QSO." }, 400);
  }

  const { data, error } = await supabase.from("qso_logs").select(qsoSelectFields).eq("id", qsoId).maybeSingle();

  if (error || !data) {
    return buildResponse({ error: "QSO záznam se nepodařilo načíst." }, 404);
  }

  const record = normalizeQsoRecord(data);
  const templatePath = join(process.cwd(), "public", "qsl-template.png");
  const template = await readFile(templatePath);

  const png = await renderQslCardPng(template, {
    callsign: record.callsign,
    qsoDate: record.date,
    timeOn: record.timeOn ?? "",
    band: record.band,
    mode: record.mode,
    rstSent: record.rstSent ?? "",
    rstRcvd: record.rstRcvd ?? "",
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
