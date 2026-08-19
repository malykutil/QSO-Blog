import "server-only";

import { getSupabaseRouteClient } from "@/src/lib/supabase-server";

const defaultTradingAdminEmail = "malykutil06@gmail.com";

export function isTradingAdminEmail(email: string | null | undefined) {
  const allowedEmail = (process.env.TRADING_ADMIN_EMAIL || defaultTradingAdminEmail).trim().toLowerCase();
  return Boolean(email && email.trim().toLowerCase() === allowedEmail);
}

export async function getTradingAdminAccess() {
  const supabase = await getSupabaseRouteClient();

  if (!supabase) {
    return { authenticated: false, allowed: false, reason: "supabase_not_configured" } as const;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { authenticated: false, allowed: false, reason: "not_authenticated" } as const;
  }

  if (!isTradingAdminEmail(user.email)) {
    return { authenticated: true, allowed: false, reason: "wrong_account" } as const;
  }

  const { data: owner, error } = await supabase
    .from("app_owners")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !owner) {
    return { authenticated: true, allowed: false, reason: "not_owner" } as const;
  }

  return { authenticated: true, allowed: true, userId: user.id } as const;
}
