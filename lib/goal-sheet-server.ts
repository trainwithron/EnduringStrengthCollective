import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GoalSheetActor = { role: "client" | "coach" } | null;

// Who may save or send one client's goal sheet: the client for themselves (a member of the group), or a coach of the group for one of its clients.
// `supabase` is the caller's own client (so "coach of the group" is the same rule the read policy uses); `db` is the service role.
export async function goalSheetActor(supabase: SupabaseClient, db: SupabaseClient, userId: string, groupId: unknown, athleteId: unknown): Promise<GoalSheetActor> {
  if (typeof groupId !== "string" || typeof athleteId !== "string" || !UUID.test(groupId) || !UUID.test(athleteId)) return null;
  const { data: seat } = await db.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", athleteId).maybeSingle();
  if (!seat) return null;
  if (athleteId === userId) return { role: "client" };
  if (seat.role !== "athlete") return null;
  const { data: isCoach } = await supabase.rpc("is_group_coach", { _group_id: groupId });
  return isCoach === true ? { role: "coach" } : null;
}
