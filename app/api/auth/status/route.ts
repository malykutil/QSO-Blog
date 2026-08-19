import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isSupabaseConfigured } from "@/src/lib/supabase";
import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { isTradingAdminEmail } from "@/src/lib/trading-auth";

export async function GET() {
  if (await hasSolarControlSession()) {
    return NextResponse.json({ authenticated: true, solarControl: true, email: null }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { authenticated: false, reason: "supabase_not_configured" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }

  try {
    const cookieStore = await cookies();

    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let tradingAdmin = false;
    if (user && isTradingAdminEmail(user.email)) {
      const { data: owner } = await supabase
        .from("app_owners")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      tradingAdmin = Boolean(owner);
    }

    return NextResponse.json(
      {
        authenticated: Boolean(user),
        email: user?.email ?? null,
        tradingAdmin,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return NextResponse.json(
      { authenticated: false, reason: "status_check_failed" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
