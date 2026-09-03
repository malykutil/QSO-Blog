import { NextResponse } from "next/server";

import { qsoSelectFields } from "@/src/lib/qso-data";
import { getSupabaseAdminClient } from "@/src/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json({ error: "Veřejná QSO data nejsou dostupná." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("qso_logs")
    .select(qsoSelectFields)
    .eq("is_public", true)
    .order("date", { ascending: false })
    .order("time_on", { ascending: false });

  if (error) {
    console.error("Public QSO map query failed", error.message);
    return NextResponse.json({ error: "Veřejná QSO data se nepodařilo načíst." }, { status: 503 });
  }

  return NextResponse.json(
    { records: data ?? [] },
    {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=30",
      },
    },
  );
}
