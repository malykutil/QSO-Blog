import { NextRequest, NextResponse } from "next/server";

import { fetchHamqthEmailBySession, getHamqthSessionId, type HamqthCredentials } from "@/src/lib/hamqth";
import { fetchQrzEmailBySession, getQrzSessionKey, type QrzCredentials } from "@/src/lib/qrz";
import { isValidEmail, normalizeQslQueueItem, qslQueueSelectFields } from "@/src/lib/qsl-data";
import { getSupabaseRouteClient } from "@/src/lib/supabase-server";

function buildResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

type LookupPayload = {
  queueId?: string;
  queueIds?: string[];
  hamqth?: Partial<HamqthCredentials>;
  qrz?: Partial<QrzCredentials>;
};

type LookupResult = {
  id: string;
  callsign: string;
  email: string;
  status: "found" | "failed";
  source?: "hamqth" | "qrz";
  error?: string;
};

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function buildCallsignCandidates(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return [];
  }

  const parts = normalized
    .split("/")
    .map((part) => part.replace(/[^A-Z0-9]/g, ""))
    .filter(Boolean);

  const likelyStationParts = parts
    .filter((part) => /[A-Z]/.test(part) && /\d/.test(part))
    .sort((left, right) => right.length - left.length);

  const merged = [normalized, ...likelyStationParts, ...parts];
  return Array.from(new Set(merged));
}

async function lookupHamqthEmail(callsign: string, sessionId: string) {
  const candidates = buildCallsignCandidates(callsign);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const email = await fetchHamqthEmailBySession(candidate, sessionId);
      return { email, matchedCallsign: candidate };
    } catch (error) {
      errors.push(`${candidate}: ${toErrorMessage(error, "dohledání selhalo.")}`);
    }
  }

  throw new Error(errors.join(" | ") || "HamQTH dohledání selhalo.");
}

async function lookupQrzEmail(callsign: string, sessionKey: string) {
  const candidates = buildCallsignCandidates(callsign);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const email = await fetchQrzEmailBySession(candidate, sessionKey);
      return { email, matchedCallsign: candidate };
    } catch (error) {
      errors.push(`${candidate}: ${toErrorMessage(error, "dohledání selhalo.")}`);
    }
  }

  throw new Error(errors.join(" | ") || "QRZ dohledání selhalo.");
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

  const payload = (await request.json().catch(() => null)) as LookupPayload | null;
  const ids = Array.from(new Set([payload?.queueId, ...(payload?.queueIds ?? [])].filter(Boolean) as string[]));

  if (!ids.length) {
    return buildResponse({ error: "Chybí QSL záznam." }, 400);
  }

  const { data, error } = await supabase
    .from("qsl_queue")
    .select(qslQueueSelectFields)
    .eq("created_by", user.id)
    .in("id", ids);

  if (error || !data?.length) {
    return buildResponse({ error: "QSL záznam se nepodařilo načíst." }, 404);
  }

  const items = data.map((row) => normalizeQslQueueItem(row));
  const singleMode = ids.length === 1;
  const results: LookupResult[] = [];

  let hamqthSessionId: string | null = null;
  let hamqthSessionError: string | null = null;
  try {
    hamqthSessionId = await getHamqthSessionId(payload?.hamqth);
  } catch (sessionError) {
    hamqthSessionError = toErrorMessage(sessionError, "HamQTH přihlášení selhalo.");
  }

  let qrzSessionKey: string | null = null;
  let qrzSessionError: string | null = null;
  try {
    qrzSessionKey = await getQrzSessionKey(payload?.qrz);
  } catch (sessionError) {
    qrzSessionError = toErrorMessage(sessionError, "QRZ přihlášení selhalo.");
  }

  for (const item of items) {
    if (item.status === "sent") {
      results.push({
        id: item.id,
        callsign: item.callsign,
        email: item.contactEmail,
        status: "failed",
        error: "QSL už byl odeslán.",
      });
      continue;
    }

    if (isValidEmail(item.contactEmail)) {
      results.push({
        id: item.id,
        callsign: item.callsign,
        email: item.contactEmail,
        status: "found",
      });
      continue;
    }

    const attempts: string[] = [];
    let foundEmail = "";
    let source: "hamqth" | "qrz" | null = null;

    if (hamqthSessionId) {
      try {
        const hamqthLookup = await lookupHamqthEmail(item.callsign, hamqthSessionId);
        foundEmail = hamqthLookup.email;
        source = "hamqth";
      } catch (lookupError) {
        attempts.push(`HamQTH: ${toErrorMessage(lookupError, "dohledání selhalo.")}`);
      }
    } else if (hamqthSessionError) {
      attempts.push(`HamQTH: ${hamqthSessionError}`);
    }

    if (!foundEmail) {
      if (qrzSessionKey) {
        try {
          const qrzLookup = await lookupQrzEmail(item.callsign, qrzSessionKey);
          foundEmail = qrzLookup.email;
          source = "qrz";
        } catch (lookupError) {
          attempts.push(`QRZ: ${toErrorMessage(lookupError, "dohledání selhalo.")}`);
        }
      } else if (qrzSessionError) {
        attempts.push(`QRZ: ${qrzSessionError}`);
      }
    }

    if (!foundEmail || !source) {
      const message =
        attempts.join(" | ") || "E-mail se nepodařilo dohledat ani přes HamQTH, ani přes QRZ.";

      await supabase
        .from("qsl_queue")
        .update({
          status: "missing_email",
          error_message: message,
        })
        .eq("id", item.id)
        .eq("created_by", user.id);

      results.push({
        id: item.id,
        callsign: item.callsign,
        email: "",
        status: "failed",
        error: message,
      });
      continue;
    }

    const { error: contactInsertError } = await supabase.from("qsl_contacts").insert({
      created_by: user.id,
      callsign: item.callsign.toUpperCase(),
      email: foundEmail,
      source,
      is_verified: false,
    });

    if (contactInsertError && contactInsertError.code !== "23505") {
      const message = contactInsertError.message;
      await supabase
        .from("qsl_queue")
        .update({
          status: "missing_email",
          error_message: message,
        })
        .eq("id", item.id)
        .eq("created_by", user.id);

      results.push({
        id: item.id,
        callsign: item.callsign,
        email: "",
        status: "failed",
        error: message,
      });
      continue;
    }

    await supabase
      .from("qsl_queue")
      .update({
        contact_email: foundEmail,
        status: "ready",
        error_message: null,
      })
      .eq("id", item.id)
      .eq("created_by", user.id);

    results.push({
      id: item.id,
      callsign: item.callsign,
      email: foundEmail,
      status: "found",
      source,
    });
  }

  const found = results.filter((item) => item.status === "found");
  const failed = results.filter((item) => item.status === "failed");

  if (singleMode) {
    if (!found.length) {
      return buildResponse({ error: failed[0]?.error || "E-mail se nepodařilo dohledat." }, 502);
    }

    return buildResponse({ email: found[0].email, source: found[0].source ?? "hamqth" }, 200);
  }

  return buildResponse(
    {
      ok: true,
      total: results.length,
      found: found.length,
      failed: failed.length,
      details: results,
    },
    200,
  );
}
