import type { SupabaseClient } from "@supabase/supabase-js";
import { pageAll } from "@/lib/page-all";

// Clients the weekly nutrition job must leave alone (Release B1). Two switches on a client say so: "No macros for [name]" (group_memberships.coach_sets_macros is false) and "No automatic nutrition
// suggestions" (client_nutrition_flags.auto_off is true: a safety switch for a client whose food and weight should only ever be approached by the coach, in person). Either one means no suggestion of any kind is
// made for that client. "No macros for [name]" is the coach's switch for one group (keys "athleteId|groupId"). The automatic-suggestions switch is a SAFETY flag and follows the PERSON: set in any group (a season
// rolled over, a move, a second coach's group), it silences the job for that person everywhere (profiles).
// A list that cannot be read in full is reported as failed so the job does not run on a part of it. The one exception is a database that does not have the flags table yet (the paste is pending): that reads as
// "nobody has switched it off", and the first switch alone is used.
const TABLE_MISSING = new Set(["42P01", "PGRST205"]);

export async function loadPausedKeys(supabase: SupabaseClient): Promise<{ keys: Set<string>; profiles: Set<string>; failed: boolean }> {
  const keys = new Set<string>();
  const profiles = new Set<string>();
  const nothing = { keys: new Set<string>(), profiles: new Set<string>(), failed: true };

  const members = await pageAll((from, to) => supabase.from("group_memberships").select("profile_id, group_id, coach_sets_macros").eq("role", "athlete").order("profile_id").order("group_id").range(from, to), { maxPages: 100 });
  if (members.failed || members.truncated) return nothing;
  for (const r of members.rows as { profile_id: string; group_id: string; coach_sets_macros: boolean | null }[]) {
    if (r.coach_sets_macros === false) keys.add(`${r.profile_id}|${r.group_id}`);
  }

  // pageAll hides the error code, so the first page is asked directly to tell "no table yet" from a real failure.
  const probe = await supabase.from("client_nutrition_flags").select("profile_id").limit(1);
  if (probe.error) {
    if (TABLE_MISSING.has((probe.error as { code?: string }).code ?? "")) return { keys, profiles, failed: false };
    return nothing;
  }
  const flags = await pageAll((from, to) => supabase.from("client_nutrition_flags").select("profile_id, group_id").eq("auto_off", true).order("profile_id").order("group_id").range(from, to), { maxPages: 100 });
  if (flags.failed || flags.truncated) return nothing;
  for (const r of flags.rows as { profile_id: string }[]) profiles.add(r.profile_id);
  return { keys, profiles, failed: false };
}
