import { NextResponse } from "next/server";

import { getTradingAdminAccess } from "@/src/lib/trading-auth";
import { tradingBackendRequest } from "@/src/lib/trading-backend";
import { isTradingDashboardPayload } from "@/src/lib/trading-types";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getTradingAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Nejdřív se přihlaste." }, { status: 401 });
  }
  if (!access.allowed) {
    return NextResponse.json({ error: "Trading přehled je dostupný pouze administrátorovi." }, { status: 403 });
  }

  try {
    const backendResponse = await tradingBackendRequest("/api/dashboard");
    if (!backendResponse.ok) {
      return NextResponse.json({ error: "Trading služba momentálně neodpovídá." }, { status: 502 });
    }
    const payload: unknown = await backendResponse.json();
    if (!isTradingDashboardPayload(payload)) {
      return NextResponse.json({ error: "Trading služba vrátila neplatná data." }, { status: 502 });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const notConfigured = error instanceof Error && error.message === "TRADING_BACKEND_NOT_CONFIGURED";
    return NextResponse.json(
      { error: notConfigured ? "Cloudová trading služba ještě není připojená." : "Trading služba není dostupná." },
      { status: notConfigured ? 503 : 502 },
    );
  }
}
