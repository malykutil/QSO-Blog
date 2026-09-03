import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

import { isValidEmail, normalizeEmail, normalizeQslQueueItem, qslQueueSelectFields } from "@/src/lib/qsl-data";
import { renderQslCardPng } from "@/src/lib/qsl-card";
import { getSupabaseAdminClient, getSupabaseRouteClient } from "@/src/lib/supabase-server";

export const runtime = "nodejs";

type ResendResponse = {
  id?: string;
  message?: string;
  name?: string;
};

const MINIMUM_SEND_INTERVAL_SECONDS = 4 * 60;
const DAILY_SEND_LIMIT = 30;
const PROVIDER_LOCK_RETRY_SECONDS = 24 * 60 * 60;

function providerTemporarilyBlocked(message: string) {
  return /(temporar(?:y|ily).*(?:lock|disable)|unusual (?:usage|activity)|too many|rate.?limit|daily.*limit|quota|4\.7\.0|4\.7\.28|534-5\.7\.14)/i.test(message);
}

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
      <p>thank you for the QSO. This is a digital QSL confirmation from my station.</p>
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
    `thank you for the QSO. This is a digital QSL confirmation from my station.`,
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
  const authorization = request.headers.get("authorization");
  const cronSecret = process.env.QSL_WORKER_SECRET || process.env.CRON_SECRET;
  const isWorker = Boolean(cronSecret && authorization === `Bearer ${cronSecret}`);
  const payload = (await request.json().catch(() => null)) as {
    queueId?: string;
    email?: string;
    ownerId?: string;
  } | null;
  const supabase = isWorker ? getSupabaseAdminClient() : await getSupabaseRouteClient();

  if (!supabase) {
    return buildResponse({ error: "Databázové připojení není nakonfigurované." }, 503);
  }

  const authenticatedUser = isWorker ? null : (await supabase.auth.getUser()).data.user;
  const ownerId = isWorker ? payload?.ownerId : authenticatedUser?.id;

  if (!ownerId) {
    return buildResponse({ error: "Pro odeslání QSL je potřeba přihlášení." }, 401);
  }

  const queueId = payload?.queueId ?? "";
  const email = normalizeEmail(payload?.email ?? "");

  if (!queueId || !isValidEmail(email)) {
    return buildResponse({ error: "Chybí platný e-mail nebo QSL záznam." }, 400);
  }

  const { data, error } = await supabase
    .from("qsl_queue")
    .select(qslQueueSelectFields)
    .eq("id", queueId)
    .eq("created_by", ownerId)
    .single();

  if (error || !data) {
    return buildResponse({ error: "QSL záznam se nepodařilo načíst." }, 404);
  }

  const item = normalizeQslQueueItem(data);

  if (item.status === "sent" || item.sentAt) {
    return buildResponse({ error: "Tenhle QSL lístek už byl odeslán." }, 409);
  }

  const now = Date.now();
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);

  const [{ data: latestSent }, { count: sentToday }] = await Promise.all([
    supabase
      .from("qsl_queue")
      .select("sent_at")
      .eq("created_by", ownerId)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("qsl_queue")
      .select("id", { count: "exact", head: true })
      .eq("created_by", ownerId)
      .gte("sent_at", todayUtc.toISOString()),
  ]);

  if ((sentToday ?? 0) >= DAILY_SEND_LIMIT) {
    const retryAfterSeconds = Math.max(60, Math.ceil((todayUtc.getTime() + 86_400_000 - now) / 1_000));
    return NextResponse.json(
      { error: `Dnešní bezpečnostní limit ${DAILY_SEND_LIMIT} QSL e-mailů byl vyčerpán.`, haltBulk: true, retryAfterSeconds },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const latestSentAt = latestSent?.sent_at ? Date.parse(latestSent.sent_at) : Number.NaN;
  const elapsedSeconds = Number.isFinite(latestSentAt) ? Math.floor((now - latestSentAt) / 1_000) : Number.POSITIVE_INFINITY;
  if (elapsedSeconds < MINIMUM_SEND_INTERVAL_SECONDS) {
    const retryAfterSeconds = MINIMUM_SEND_INTERVAL_SECONDS - elapsedSeconds;
    return NextResponse.json(
      { error: `Další QSL lze bezpečně odeslat za ${Math.ceil(retryAfterSeconds / 60)} min.`, retryAfterSeconds },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  const gmailUser = process.env.GMAIL_USER;
  const gmailAppPassword = process.env.GMAIL_APP_PASSWORD;
  const fromEmail = process.env.QSL_FROM_EMAIL || gmailUser;
  const fromName = process.env.QSL_FROM_NAME || "OK2MKJ QSL";
  const replyTo = process.env.QSL_REPLY_TO_EMAIL || fromEmail;

  if ((!apiKey && !(gmailUser && gmailAppPassword)) || !fromEmail) {
    return buildResponse(
      { error: "Chybí nastavení Gmailu nebo Resend na serveru." },
      503,
    );
  }

  const resolvedItem = { ...item, contactEmail: email };
  const attachmentFilename = `QSL-OK2MKJ-${item.callsign.replace(/[^A-Z0-9/-]/gi, "_") || "QSO"}.png`;
  let qslCard: Buffer;

  try {
    const template = await readFile(join(process.cwd(), "public", "qsl-template.png"));
    qslCard = await renderQslCardPng(template, {
      callsign: item.callsign,
      qsoDate: item.qsoDate,
      timeOn: item.timeOn,
      band: item.band,
      mode: item.mode,
      rstSent: item.rstSent,
      rstRcvd: item.rstRcvd,
    });
  } catch {
    return buildResponse({ error: "QSL lístek se nepodařilo vytvořit pro přílohu." }, 500);
  }

  let providerMessageId: string | null = null;
  let providerError = "";

  if (gmailUser && gmailAppPassword) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmailUser, pass: gmailAppPassword },
      });
      const result = await transporter.sendMail({
        from: `${fromName} <${fromEmail}>`,
        to: email,
        replyTo,
        subject: `QSL OK2MKJ - ${item.callsign} ${item.qsoDate || ""}`.trim(),
        html: buildEmailHtml(resolvedItem),
        text: buildEmailText(resolvedItem),
        attachments: [
          {
            filename: attachmentFilename,
            content: qslCard,
            contentType: "image/png",
          },
        ],
      });
      providerMessageId = result.messageId;
    } catch (error) {
      providerError = error instanceof Error ? error.message : "Odeslání přes Gmail selhalo.";
    }
  }

  const resendResponse = providerMessageId || !apiKey ? null : await fetch("https://api.resend.com/emails", {
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
          filename: attachmentFilename,
          content: qslCard.toString("base64"),
        },
      ],
    }),
  });

  const resendPayload = resendResponse ? (await resendResponse.json().catch(() => null)) as ResendResponse | null : null;

  if (!providerMessageId && (!resendResponse?.ok || providerError)) {
    const message = providerError || resendPayload?.message || resendPayload?.name || "Odeslání e-mailu selhalo.";
    const temporarilyBlocked = providerTemporarilyBlocked(message);
    await supabase
      .from("qsl_queue")
      .update({
        contact_email: email,
        status: "failed",
        error_message: message,
      })
      .eq("id", queueId)
      .eq("created_by", ownerId);

    if (temporarilyBlocked) {
      return NextResponse.json(
        {
          error: "Gmail účet je dočasně zablokovaný kvůli neobvyklé aktivitě. Odesílání bylo zastaveno na 24 hodin.",
          haltBulk: true,
          retryAfterSeconds: PROVIDER_LOCK_RETRY_SECONDS,
        },
        {
          status: 423,
          headers: { "Cache-Control": "no-store", "Retry-After": String(PROVIDER_LOCK_RETRY_SECONDS) },
        },
      );
    }

    return buildResponse({ error: message }, 502);
  }

  const sentAt = new Date().toISOString();

  await supabase.from("qsl_contacts").insert({
    created_by: ownerId,
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
    .eq("created_by", ownerId)
    .eq("callsign", item.callsign.toUpperCase())
    .eq("email", email);

  await supabase
    .from("qsl_queue")
    .update({
      contact_email: email,
      status: "sent",
      approved_at: sentAt,
      sent_at: sentAt,
      provider_message_id: providerMessageId ?? resendPayload?.id ?? null,
      error_message: null,
    })
    .eq("id", queueId)
    .eq("created_by", ownerId);

  return buildResponse({ ok: true, id: providerMessageId ?? resendPayload?.id ?? null }, 200);
}
