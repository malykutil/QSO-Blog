import { NextResponse } from "next/server";

import { getSupabasePublicServerClient } from "@/src/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const supabase = getSupabasePublicServerClient();
  if (!supabase) return NextResponse.json({ error: "Počítadlo není dostupné." }, { status: 503 });

  const { data, error } = await supabase.rpc("increment_blog_post_view", { post_slug: slug });
  const viewCount = Array.isArray(data) ? data[0] : data;
  if (error || typeof viewCount !== "number") {
    return NextResponse.json({ error: "Článek nebyl nalezen." }, { status: error ? 503 : 404 });
  }

  return NextResponse.json(
    { viewCount },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
