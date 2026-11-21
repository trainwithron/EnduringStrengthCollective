import type { SupabaseClient } from "@supabase/supabase-js";

// A coach's PERSONAL SPACE (lib/personal-space.ts, ensure_personal_space): the one group they made with no organization, where they are its coach and its athlete is themselves (Ron, Nov 21:
// "I want to be able to assign meal plans to myself"). The places that act for "the athlete" (importing nutrition history, asking for a different plan, the allergy rebuild) allow this one
// case besides a real athlete membership: the person acting is the athlete, and the group is their own personal space. Never anyone else's, and never a group of an organization.
// Read with the service role after the route has the signed-in user; a failed read is "no".

export async function isOwnPersonalSpace(db: SupabaseClient, userId: string, groupId: string): Promise<boolean> {
  if (!userId || !groupId) return false;
  try {
    const { data, error } = await db.from("groups").select("id").eq("id", groupId).eq("created_by", userId).is("organization_id", null).maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

/** The person's own personal space, when they have one (none, or a failed read: none). */
export async function ownPersonalSpaceIds(db: SupabaseClient, userId: string): Promise<string[]> {
  if (!userId) return [];
  try {
    const { data, error } = await db.from("groups").select("id").eq("created_by", userId).is("organization_id", null);
    if (error) return [];
    return ((data ?? []) as { id: string }[]).map((g) => g.id);
  } catch {
    return [];
  }
}
