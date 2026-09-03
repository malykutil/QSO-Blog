import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
  const store = await cookies();
  const email = store.get("gmail_email")?.value || null;
  return NextResponse.json({ connected: Boolean(store.get("gmail_refresh_token")?.value || store.get("gmail_access_token")?.value), email }, { headers: { "Cache-Control": "no-store" } });
}
