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

// The coach's own row on coach Nutrition (Ron, Nov 21): their personal space, made the first time it is needed by the same database function the program assign panel and
// /my-space use (ensure_personal_space returns the one space there is, or makes it). Everything set on that row saves to it, with the coach as the athlete.
export async function openOwnNutritionSpace(supabase: SupabaseClient, userId: string): Promise<{ groupId: string | null; problem: string | null }> {
  void userId; // the function reads the signed-in person itself
  try {
    const { data, error } = await supabase.rpc("ensure_personal_space");
    if (error || !data) {
      return { groupId: null, problem: error?.message?.includes("Only coaches") ? "Only coaches have their own nutrition here." : "Couldn't open your own nutrition just now. Reload to try again." };
    }
    return { groupId: data as string, problem: null };
  } catch {
    return { groupId: null, problem: "Couldn't open your own nutrition just now. Reload to try again." };
  }
}
