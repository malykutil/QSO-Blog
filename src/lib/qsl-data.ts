import type { SupabaseClient } from "@supabase/supabase-js";

import { getQsoFingerprint, type QsoRecord } from "@/src/lib/qso-data";

export type QslStatus = "missing_email" | "ready" | "sent" | "failed";

export type QslQueueItem = {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  qsoId: string | null;
  qsoFingerprint: string;
  callsign: string;
  band: string;
  mode: string;
  qsoDate: string;
  timeOn: string;
  rstSent: string;
  rstRcvd: string;
  locator: string;
  contactEmail: string;
  status: QslStatus;
  approvedAt: string | null;
  sentAt: string | null;
  providerMessageId: string | null;
  errorMessage: string | null;
};

export type QslContact = {
  id: string;
  callsign: string;
  email: string;
  source: string;
  isVerified: boolean;
  note: string | null;
  lastUsedAt: string | null;
};

type QslQueueRow = {
  id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  qso_id?: string | null;
  qso_fingerprint?: string | null;
  callsign?: string | null;
  band?: string | null;
  mode?: string | null;
  qso_date?: string | null;
  time_on?: string | null;
  rst_sent?: string | null;
  rst_rcvd?: string | null;
  locator?: string | null;
  contact_email?: string | null;
  status?: string | null;
  approved_at?: string | null;
  sent_at?: string | null;
  provider_message_id?: string | null;
  error_message?: string | null;
};

type QslContactRow = {
  id?: string | null;
  callsign?: string | null;
  email?: string | null;
  source?: string | null;
  is_verified?: boolean | null;
  note?: string | null;
  last_used_at?: string | null;
};

export const qslQueueSelectFields =
  "id,created_at,updated_at,created_by,qso_id,qso_fingerprint,callsign,band,mode,qso_date,time_on,rst_sent,rst_rcvd,locator,contact_email,status,approved_at,sent_at,provider_message_id,error_message";

export const qslContactSelectFields = "id,callsign,email,source,is_verified,note,last_used_at";

export function normalizeQslQueueItem(row: QslQueueRow): QslQueueItem {
  const status = row.status === "ready" || row.status === "sent" || row.status === "failed" ? row.status : "missing_email";

  return {
    id: row.id ?? "",
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    createdBy: row.created_by ?? "",
    qsoId: row.qso_id ?? null,
    qsoFingerprint: row.qso_fingerprint ?? "",
    callsign: row.callsign ?? "",
    band: row.band ?? "",
    mode: row.mode ?? "",
    qsoDate: row.qso_date ?? "",
    timeOn: row.time_on ?? "",
    rstSent: row.rst_sent ?? "",
    rstRcvd: row.rst_rcvd ?? "",
    locator: row.locator ?? "",
    contactEmail: row.contact_email ?? "",
    status,
    approvedAt: row.approved_at ?? null,
    sentAt: row.sent_at ?? null,
    providerMessageId: row.provider_message_id ?? null,
    errorMessage: row.error_message ?? null,
  };
}

export function normalizeQslContact(row: QslContactRow): QslContact {
  return {
    id: row.id ?? "",
    callsign: row.callsign ?? "",
    email: row.email ?? "",
    source: row.source ?? "manual",
    isVerified: row.is_verified ?? false,
    note: row.note ?? null,
    lastUsedAt: row.last_used_at ?? null,
  };
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function normalizeCallsign(value: string) {
  return value.trim().toUpperCase();
}

export function getQslStatusLabel(status: QslStatus) {
  if (status === "sent") {
    return "Odesláno";
  }

  if (status === "ready") {
    return "Připraveno";
  }

  if (status === "failed") {
    return "Chyba";
  }

  return "Chybí e-mail";
}

export async function ensureQslQueueForRecords({
  supabase,
  records,
  userId,
}: {
  supabase: SupabaseClient;
  records: QsoRecord[];
  userId: string;
}) {
  const recordsWithIds = records.filter((record) => record.id);

  if (!recordsWithIds.length) {
    return { inserted: 0, skipped: 0 };
  }

  const fingerprints = recordsWithIds.map((record) => getQsoFingerprint(record));
  const callsigns = Array.from(new Set(recordsWithIds.map((record) => normalizeCallsign(record.callsign)).filter(Boolean)));

  const [{ data: existingRows }, { data: contactRows }] = await Promise.all([
    supabase
      .from("qsl_queue")
      .select("qso_fingerprint")
      .eq("created_by", userId)
      .in("qso_fingerprint", fingerprints),
    supabase
      .from("qsl_contacts")
      .select(qslContactSelectFields)
      .eq("created_by", userId)
      .in("callsign", callsigns),
  ]);

  const existingFingerprints = new Set((existingRows ?? []).map((row) => String(row.qso_fingerprint ?? "")));
  const contactsByCallsign = new Map<string, QslContact>();

  for (const row of contactRows ?? []) {
    const contact = normalizeQslContact(row);
    if (contact.isVerified && contact.email) {
      contactsByCallsign.set(normalizeCallsign(contact.callsign), contact);
    }
  }

  const payload = recordsWithIds
    .filter((record) => !existingFingerprints.has(getQsoFingerprint(record)))
    .map((record) => {
      const callsign = normalizeCallsign(record.callsign);
      const contact = contactsByCallsign.get(callsign);
      const contactEmail = contact?.email ?? "";

      return {
        created_by: userId,
        qso_id: record.id,
        qso_fingerprint: getQsoFingerprint(record),
        callsign,
        band: record.band || null,
        mode: record.mode || null,
        qso_date: record.date || null,
        time_on: record.timeOn || null,
        rst_sent: record.rstSent || null,
        rst_rcvd: record.rstRcvd || null,
        locator: record.locator || null,
        contact_email: contactEmail || null,
        status: contactEmail ? "ready" : "missing_email",
      };
    });

  if (!payload.length) {
    return { inserted: 0, skipped: recordsWithIds.length };
  }

  const { error } = await supabase.from("qsl_queue").insert(payload);

  if (error) {
    throw new Error(error.message);
  }

  return { inserted: payload.length, skipped: recordsWithIds.length - payload.length };
}
