import type { SupabaseClient } from "@supabase/supabase-js";
import { discardEmptyGroup } from "@/lib/discard-empty-group";

// The one way a group is created from the app: the group, then the creating coach as its coach, and if the coach seat cannot be made the group is taken back (through the server, since a signed-in person
// cannot delete a group directly), so nobody is left with a group they cannot open. The id is made here because a new group has no membership yet and so cannot be read back after the insert.
export async function createGroupWithCoach(
  supabase: SupabaseClient,
  { userId, name, organizationId, kind, discard = discardEmptyGroup }: { userId: string; name: string; organizationId: string; kind: "team" | "social" | "one_on_one" | string; discard?: (groupId: string) => Promise<boolean> }
): Promise<{ id: string | null; error: string | null }> {
  const id = crypto.randomUUID();
  const { error: groupError } = await supabase.from("groups").insert({ id, name, created_by: userId, organization_id: organizationId, group_kind: kind });
  if (groupError) return { id: null, error: "Couldn't create the group. Try again." };
  const { error: seatError } = await supabase.from("group_memberships").insert({ group_id: id, profile_id: userId, role: "coach" });
  if (seatError) {
    await discard(id);
    return { id: null, error: "Couldn't create the group. Try again." };
  }
  return { id, error: null };
}
