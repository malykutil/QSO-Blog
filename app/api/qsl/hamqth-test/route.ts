import { NextRequest, NextResponse } from "next/server";

import { testHamqthConnection, type HamqthCredentials } from "@/src/lib/hamqth";
import { getSupabaseRouteClient } from "@/src/lib/supabase-server";

function buildResponse(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
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
    return buildResponse({ error: "Pro test HamQTH je potřeba přihlášení." }, 401);
  }

  const payload = (await request.json().catch(() => null)) as {
    hamqth?: Partial<HamqthCredentials>;
  } | null;

  try {
    await testHamqthConnection(payload?.hamqth);
    return buildResponse({ ok: true }, 200);
  } catch (error) {
    return buildResponse(
      { error: error instanceof Error ? error.message : "HamQTH propojení se nepodařilo ověřit." },
      502,
    );
  }
}
