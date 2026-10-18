import type { SupabaseClient } from "@supabase/supabase-js";

// The narrow reads an athlete's screens use to see who else is in their group (migration 0404): a name, a photo, a role and, for a team, a position, and nothing else about anyone. Until that migration is applied the
// functions do not exist, and the screens fall back to the older direct read so a deploy that comes first changes nothing. Works with the browser or the server client.
const missingFunction = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message ?? ""));

export interface GroupMemberName {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  role: string;
}

export async function readGroupMemberNames(supabase: SupabaseClient, groupId: string): Promise<GroupMemberName[]> {
  const { data, error } = await supabase.rpc("group_member_names", { p_group: groupId });
  if (!error) {
    return ((data ?? []) as { profile_id: string; full_name: string | null; avatar_url: string | null; role: string }[])
      .map((r) => ({ id: r.profile_id, fullName: r.full_name ?? "", avatarUrl: r.avatar_url, role: r.role }))
      .filter((m) => m.fullName);
  }
  if (!missingFunction(error)) return [];
  const { data: rows } = await supabase.from("group_memberships").select("profile_id, role, profiles ( full_name, avatar_url )").eq("group_id", groupId);
  return ((rows ?? []) as any[])
    .map((r) => ({ id: r.profile_id as string, fullName: (r.profiles?.full_name ?? "") as string, avatarUrl: (r.profiles?.avatar_url ?? null) as string | null, role: r.role as string }))
    .filter((m) => m.fullName);
}

export interface PositionRosterRow {
  profileId: string;
  fullName: string | null;
  feedBroadcastLevel: string | null;
  positionId: string | null;
  positionName: string | null;
  positionSortOrder: number | null;
}

// The athletes of a group with their position. null means the read failed (the caller decides what a failed read shows).
export async function readPositionRoster(supabase: SupabaseClient, groupId: string): Promise<PositionRosterRow[] | null> {
  const { data, error } = await supabase.rpc("group_position_roster", { p_group: groupId });
  if (!error) {
    return ((data ?? []) as { profile_id: string; full_name: string | null; feed_broadcast_level: string | null; position_id: string | null; position_name: string | null; position_sort_order: number | null }[]).map((r) => ({
      profileId: r.profile_id,
      fullName: r.full_name,
      feedBroadcastLevel: r.feed_broadcast_level,
      positionId: r.position_id,
      positionName: r.position_name,
      positionSortOrder: r.position_sort_order,
    }));
  }
  if (!missingFunction(error)) return null;
  const { data: rows, error: fallbackError } = await supabase
    .from("group_memberships")
    .select("profile_id, position_id, profiles ( full_name, feed_broadcast_level ), group_positions!group_memberships_position_id_fkey ( name, sort_order )")
    .eq("group_id", groupId)
    .eq("role", "athlete");
  if (fallbackError) return null;
  return ((rows ?? []) as any[]).map((m) => ({
    profileId: m.profile_id as string,
    fullName: (m.profiles?.full_name ?? null) as string | null,
    feedBroadcastLevel: (m.profiles?.feed_broadcast_level ?? null) as string | null,
    positionId: (m.position_id ?? null) as string | null,
    positionName: (m.group_positions?.name ?? null) as string | null,
    positionSortOrder: (m.group_positions?.sort_order ?? null) as number | null,
  }));
}

// How many people are in the group, for the "N members" line: asked of the database (migration 0406) because an athlete can no longer read the other athletes' rows to count them. Until that function exists, or if it
// cannot be read, the number of rows the page itself could read is used (which is the whole group wherever the old open read still applies).
export async function readGroupMemberCount(supabase: SupabaseClient, groupId: string, fallback: number): Promise<number> {
  const { data, error } = await supabase.rpc("group_member_count", { p_group: groupId });
  if (error || typeof data !== "number") return fallback;
  return data;
}
