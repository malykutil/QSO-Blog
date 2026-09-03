import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, service: "qso-blog2", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
