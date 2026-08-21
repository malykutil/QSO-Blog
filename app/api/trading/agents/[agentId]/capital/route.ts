import { NextResponse, type NextRequest } from "next/server";

import { getTradingAdminAccess } from "@/src/lib/trading-auth";
import { tradingBackendRequest } from "@/src/lib/trading-backend";

type CapitalPayload = {
  capital?: unknown;
  reset_history?: unknown;
  preserve_history?: unknown;
};

export async function PUT(request: NextRequest, context: RouteContext<"/api/trading/agents/[agentId]/capital">) {
  const access = await getTradingAdminAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Nejdřív se přihlaste." }, { status: 401 });
  }
  if (!access.allowed) {
    return NextResponse.json({ error: "Změnu smí provést pouze administrátor." }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Neplatný původ požadavku." }, { status: 403 });
  }

  const { agentId } = await context.params;
  const numericAgentId = Number(agentId);
  if (!Number.isInteger(numericAgentId) || numericAgentId < 1 || numericAgentId > 1000) {
    return NextResponse.json({ error: "Neplatný agent." }, { status: 400 });
  }

  const payload = (await request.json().catch(() => null)) as CapitalPayload | null;
  const capital = payload?.capital;
  const resetHistory = payload?.reset_history;
  const preserveHistory = payload?.preserve_history;
  if (
    typeof capital !== "number" ||
    !Number.isFinite(capital) ||
    capital < 100 ||
    capital > 1_000_000_000 ||
    typeof resetHistory !== "boolean" ||
    typeof preserveHistory !== "boolean"
  ) {
    return NextResponse.json({ error: "Neplatné nastavení kapitálu." }, { status: 400 });
  }

  try {
    const backendResponse = await tradingBackendRequest(`/api/agents/${numericAgentId}/capital`, {
      method: "PUT",
      body: { capital, reset_history: resetHistory, preserve_history: preserveHistory },
    });
    const result = (await backendResponse.json().catch(() => null)) as Record<string, unknown> | null;
    if (!backendResponse.ok) {
      const detail = typeof result?.detail === "string" ? result.detail : "Kapitál se nepodařilo změnit.";
      return NextResponse.json({ error: detail }, { status: backendResponse.status === 409 ? 409 : 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const notConfigured = error instanceof Error && error.message === "TRADING_BACKEND_NOT_CONFIGURED";
    return NextResponse.json(
      { error: notConfigured ? "Cloudová trading služba ještě není připojená." : "Trading služba není dostupná." },
      { status: notConfigured ? 503 : 502 },
    );
  }
}
