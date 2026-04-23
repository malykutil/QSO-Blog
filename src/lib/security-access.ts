export type SecurityAccessRecord = {
  id: string;
  visitedAt: string;
  createdAt: string;
  path: string;
  method: string;
  visitorType: "anon" | "authenticated";
  userId: string | null;
  userEmail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  referer: string | null;
};

export function normalizeSecurityAccessRecord(row: Record<string, unknown>): SecurityAccessRecord {
  return {
    id: String(row.id ?? ""),
    visitedAt: String(row.visited_at ?? ""),
    createdAt: String(row.created_at ?? ""),
    path: String(row.path ?? ""),
    method: String(row.method ?? "GET"),
    visitorType: row.visitor_type === "authenticated" ? "authenticated" : "anon",
    userId: typeof row.user_id === "string" ? row.user_id : null,
    userEmail: typeof row.user_email === "string" ? row.user_email : null,
    ipAddress: typeof row.ip_address === "string" ? row.ip_address : null,
    userAgent: typeof row.user_agent === "string" ? row.user_agent : null,
    referer: typeof row.referer === "string" ? row.referer : null,
  };
}

export function formatAccessDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function toDatetimeLocalValue(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function getDeviceLabel(userAgent: string | null) {
  if (!userAgent) {
    return "Neznamo";
  }

  const lower = userAgent.toLowerCase();

  if (/(iphone|android|mobile|windows phone)/.test(lower)) {
    return "Mobil";
  }

  if (/(ipad|tablet)/.test(lower)) {
    return "Tablet";
  }

  return "Desktop";
}

