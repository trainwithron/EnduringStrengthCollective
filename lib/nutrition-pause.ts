import type { SupabaseClient } from "@supabase/supabase-js";
import { pageAll } from "@/lib/page-all";

// Clients the weekly nutrition job must leave alone (Release B1). Two switches on a client's membership say so: "No macros for [name]" (coach_sets_macros is false) and "No automatic nutrition suggestions"
// (nutrition_auto_off is true: a safety switch for a client whose food and weight should only ever be approached by the coach, in person). Either one means no suggestion of any kind is made for that client in that group.
// The answer is a set of "athleteId|groupId" keys. Until the second column exists the first switch alone is read; a list that cannot be read in full is reported as failed so the job does not run on a part of it.
export async function loadPausedKeys(supabase: SupabaseClient): Promise<{ keys: Set<string>; failed: boolean }> {
  const read = (columns: string) =>
    pageAll((from, to) => supabase.from("group_memberships").select(columns).eq("role", "athlete").order("profile_id").order("group_id").range(from, to), { maxPages: 100 });
  let page = await read("profile_id, group_id, coach_sets_macros, nutrition_auto_off");
  if (page.failed) page = await read("profile_id, group_id, coach_sets_macros");
  if (page.failed || page.truncated) return { keys: new Set(), failed: true };
  const keys = new Set<string>();
  for (const r of page.rows as { profile_id: string; group_id: string; coach_sets_macros?: boolean | null; nutrition_auto_off?: boolean | null }[]) {
    if (r.coach_sets_macros === false || r.nutrition_auto_off === true) keys.add(`${r.profile_id}|${r.group_id}`);
  }
  return { keys, failed: false };
}
