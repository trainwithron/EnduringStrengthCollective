import type { SupabaseClient } from "@supabase/supabase-js";

// Whether this person coaches any group. The coach-only tools check it before doing any paid work.
export async function userIsCoach(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("group_memberships").select("group_id").eq("profile_id", userId).eq("role", "coach").limit(1).maybeSingle();
  return !!data;
}
