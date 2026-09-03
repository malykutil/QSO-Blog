import { hasSolarControlSession } from "@/src/lib/solar-auth";
import { getSupabaseRouteClient } from "@/src/lib/supabase-server";

export async function canManageSolarControl() {
  if (await hasSolarControlSession()) return true;
  const client = await getSupabaseRouteClient();
  if (!client) return false;
  const { data: { user } } = await client.auth.getUser();
  if (!user) return false;
  const { data: owner } = await client.from("app_owners").select("user_id").eq("user_id", user.id).maybeSingle();
  return Boolean(owner);
}
