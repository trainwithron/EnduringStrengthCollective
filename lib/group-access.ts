import type { SupabaseClient } from "@supabase/supabase-js";

// The caller's own role in a group, read with the caller's own session (a person can always read their own
// membership row), or null when they don't belong to it. Server routes that act with the service role use this
// first, so the service role is never the only thing standing between a signed-in stranger and another group.
export async function getCallerGroupRole(
  supabase: SupabaseClient,
  userId: string,
  groupId: string
): Promise<"coach" | "athlete" | null> {
  const { data } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", userId)
    .maybeSingle();
  if (data?.role === "coach") return "coach";
  if (data?.role === "athlete") return "athlete";
  return null;
}
