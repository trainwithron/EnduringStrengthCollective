import type { SupabaseClient } from "@supabase/supabase-js";

// Clients the coach has set aside as inactive (migration 0281), as a set of `${groupId}:${profileId}` keys. Fails soft: before that database update
// the column does not exist, the lookup errors, and nobody is treated as inactive, so every screen behaves exactly as it did.
export const inactiveKey = (groupId: string, profileId: string) => `${groupId}:${profileId}`;

export async function fetchInactiveKeys(supabase: SupabaseClient, groupIds: string[]): Promise<Set<string>> {
  if (groupIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("group_memberships")
    .select("group_id, profile_id")
    .in("group_id", groupIds)
    .eq("role", "athlete")
    .not("inactive_at", "is", null);
  if (error) return new Set();
  return new Set(((data ?? []) as { group_id: string; profile_id: string }[]).map((r) => inactiveKey(r.group_id, r.profile_id)));
}
