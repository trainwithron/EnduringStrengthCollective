import type { createBrowserClient } from "@/lib/supabase/client";

// group_kind_enforcement_investigation_sept29.md — a real production
// group ended up with 2 athletes despite being tagged group_kind
// 'one_on_one', via at least 3 separate entry points (invite-link
// reuse, the Add-Client "existing group" destination, and the
// Change-Client-Group "move to existing group" flow), none of which
// checked group_kind at all. Shared, single source of truth for the
// app-level pre-check at all three: a real, specific message before the
// write is attempted, rather than a raw constraint-violation error (or,
// before the hard constraint existed, no error at all).
export async function checkOneOnOneGroupHasRoom(
  supabase: ReturnType<typeof createBrowserClient>,
  groupId: string
): Promise<string | null> {
  const { data: group } = await supabase
    .from("groups")
    .select("group_kind, name")
    .eq("id", groupId)
    .maybeSingle();
  if (group?.group_kind !== "one_on_one") return null;

  const { count } = await supabase
    .from("group_memberships")
    .select("*", { count: "exact", head: true })
    .eq("group_id", groupId)
    .eq("role", "athlete");

  if ((count ?? 0) > 0) {
    return `"${group.name}" is a 1-on-1 group and already has a client — pick a different group, or create a new one.`;
  }
  return null;
}
