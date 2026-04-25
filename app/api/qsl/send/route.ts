import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { renderQslCardPng } from "@/src/lib/qsl-card";
import { isValidEmail, normalizeEmail, normalizeQslQueueItem, qslQueueSelectFields } from "@/src/lib/qsl-data";
import { getSupabaseRouteClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

type ResendResponse = {
  id?: string;
  message?: string;
  name?: string;
};

function buildResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

function buildEmailHtml(item: ReturnType<typeof normalizeQslQueueItem>) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
      <h1 style="font-size:22px;margin:0 0 16px">QSL confirmation from OK2MKJ</h1>
      <p>Hello ${item.callsign},</p>
      <p>thank you for the QSO. The filled QSL card is attached to this e-mail.</p>
      <table style="border-collapse:collapse;margin:18px 0">
        <tr><td style="padding:6px 14px 6px 0;color:#475569">Callsign</td><td style="padding:6px 0;font-weight:bold">${item.callsign}</td></tr>
        <tr><td style="padding:6px 14px 6px 0;color:#475569">Date</td><td style="padding:6px 0">${item.qsoDate || "--"}</td></tr>
        <tr><td style="padding:6px 14px 6px 0;color:#475569">Time UTC</td><td style="padding:6px 0">${item.timeOn || "--"}</td></tr>
        <tr><td style="padding:6px 14px 6px 0;color:#475569">Band / mode</td><td style="padding:6px 0">${item.band || "--"} / ${item.mode || "--"}</td></tr>
        <tr><td style="padding:6px 14px 6px 0;color:#475569">RST</td><td style="padding:6px 0">${item.rstSent || "--"} / ${item.rstRcvd || "--"}</td></tr>
        <tr><td style="padding:6px 14px 6px 0;color:#475569">Locator</td><td style="padding:6px 0">${item.locator || "--"}</td></tr>
      </table>
      <p>73,<br />Jakub / OK2MKJ</p>
    </div>
  `;
}

function buildEmailText(item: ReturnType<typeof normalizeQslQueueItem>) {
  return [
    `QSL confirmation from OK2MKJ`,
    ``,
    `Hello ${item.callsign},`,
    `thank you for the QSO.`,
    ``,
    `Callsign: ${item.callsign}`,
    `Date: ${item.qsoDate || "--"}`,
    `Time UTC: ${item.timeOn || "--"}`,
    `Band / mode: ${item.band || "--"} / ${item.mode || "--"}`,
    `RST: ${item.rstSent || "--"} / ${item.rstRcvd || "--"}`,
    `Locator: ${item.locator || "--"}`,
    ``,
    `73,`,
    `Jakub / OK2MKJ`,
  ].join("\n");
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
    return buildResponse({ error: "Pro odeslání QSL je potřeba přihlášení." }, 401);
  }

  const payload = (await request.json().catch(() => null)) as { queueId?: string; email?: string } | null;
  const queueId = payload?.queueId ?? "";
  const email = normalizeEmail(payload?.email ?? "");

  if (!queueId || !isValidEmail(email)) {
    return buildResponse({ error: "Chybí platný e-mail nebo QSL záznam." }, 400);
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

  if (item.status === "sent" || item.sentAt) {
    return buildResponse({ error: "Tenhle QSL lístek už byl odeslán." }, 409);
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.QSL_FROM_EMAIL;
  const fromName = process.env.QSL_FROM_NAME || "OK2MKJ QSL";
  const replyTo = process.env.QSL_REPLY_TO_EMAIL || fromEmail;

  if (!apiKey || !fromEmail) {
    return buildResponse(
      { error: "Chybí RESEND_API_KEY nebo QSL_FROM_EMAIL. Doplň je ve Vercelu jako Environment Variables." },
      503,
    );
  }

  const resolvedItem = { ...item, contactEmail: email };
  let qslCardPng: Buffer;

  try {
    const template = await readFile(path.join(process.cwd(), "public", "qsl-template.png"));
    qslCardPng = await renderQslCardPng(template, {
      callsign: item.callsign,
      qsoDate: item.qsoDate,
      timeOn: item.timeOn,
      band: item.band,
      mode: item.mode,
      rstSent: item.rstSent,
      rstRcvd: item.rstRcvd,
    });
  } catch {
    return buildResponse({ error: "QSL šablonu se nepodařilo vyplnit." }, 500);
  }

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [email],
      reply_to: replyTo,
      subject: `QSL OK2MKJ - ${item.callsign} ${item.qsoDate || ""}`.trim(),
      html: buildEmailHtml(resolvedItem),
      text: buildEmailText(resolvedItem),
      attachments: [
        {
          filename: `QSL-OK2MKJ-${item.callsign}-${item.qsoDate || "qso"}.png`,
          content: qslCardPng.toString("base64"),
        },
      ],
    }),
  });

  const resendPayload = (await resendResponse.json().catch(() => null)) as ResendResponse | null;

  if (!resendResponse.ok) {
    const message = resendPayload?.message || resendPayload?.name || "Odeslání přes Resend selhalo.";
    await supabase
      .from("qsl_queue")
      .update({
        contact_email: email,
        status: "failed",
        error_message: message,
      })
      .eq("id", queueId)
      .eq("created_by", user.id);

    return buildResponse({ error: message }, 502);
  }

  const sentAt = new Date().toISOString();

  await supabase.from("qsl_contacts").insert({
    created_by: user.id,
    callsign: item.callsign.toUpperCase(),
    email,
    source: "manual",
    is_verified: true,
    last_used_at: sentAt,
  });

  await supabase
    .from("qsl_contacts")
    .update({
      source: "manual",
      is_verified: true,
      last_used_at: sentAt,
    })
    .eq("created_by", user.id)
    .eq("callsign", item.callsign.toUpperCase())
    .eq("email", email);

  await supabase
    .from("qsl_queue")
    .update({
      contact_email: email,
      status: "sent",
      approved_at: sentAt,
      sent_at: sentAt,
      provider_message_id: resendPayload?.id ?? null,
      error_message: null,
    })
    .eq("id", queueId)
    .eq("created_by", user.id);

  return buildResponse({ ok: true, id: resendPayload?.id ?? null }, 200);
}
