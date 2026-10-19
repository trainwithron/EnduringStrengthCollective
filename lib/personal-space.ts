import type { SupabaseClient } from "@supabase/supabase-js";

// The coach's own personal space: a group with no organization that they created (migration 0358). It is where a coach's OWN training lives, so on the pages a client uses for themselves (About you, My goal, My exercise
// history, the More list) the coach is treated as the client there, and nowhere else. Those pages used to refuse the coach's role ("This page is for clients", "Ask your coach to enable this").
export async function inOwnPersonalSpace(supabase: SupabaseClient, groupId: string, userId: string): Promise<boolean> {
  try {
    const { data } = await supabase.from("groups").select("organization_id, created_by").eq("id", groupId).maybeSingle();
    const g = data as { organization_id: string | null; created_by: string | null } | null;
    return !!g && g.organization_id === null && g.created_by === userId;
  } catch {
    return false;
  }
}
