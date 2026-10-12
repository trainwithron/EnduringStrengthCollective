import type { SupabaseClient } from "@supabase/supabase-js";

// A page or route that takes a client's id from the address must first check the person really belongs to the group in the address. Being a coach of the group proves nothing about any other person
// (the database refuses rows about people outside the group too, but a page should not even open for a stranger's id).
export async function isMemberOfGroup(supabase: SupabaseClient, groupId: string, profileId: string): Promise<boolean> {
  const { data } = await supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("profile_id", profileId).maybeSingle();
  return !!data;
}

export const NOT_IN_GROUP_MESSAGE = "That person isn't a client in this group.";
