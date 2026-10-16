import type { SupabaseClient } from "@supabase/supabase-js";

// The one way a group is created from the app: the group, then the creating coach as its coach, and if the coach seat cannot be made the group is removed again, so nobody is left with a group they cannot
// open (which would also block the same name later). The id is made here because a new group has no membership yet and so cannot be read back after the insert.
export async function createGroupWithCoach(
  supabase: SupabaseClient,
  { userId, name, organizationId, kind }: { userId: string; name: string; organizationId: string; kind: "team" | "social" | "one_on_one" | string }
): Promise<{ id: string | null; error: string | null }> {
  const id = crypto.randomUUID();
  const { error: groupError } = await supabase.from("groups").insert({ id, name, created_by: userId, organization_id: organizationId, group_kind: kind });
  if (groupError) return { id: null, error: "Couldn't create the group. Try again." };
  const { error: seatError } = await supabase.from("group_memberships").insert({ group_id: id, profile_id: userId, role: "coach" });
  if (seatError) {
    await supabase.from("groups").delete().eq("id", id);
    return { id: null, error: "Couldn't create the group. Try again." };
  }
  return { id, error: null };
}
