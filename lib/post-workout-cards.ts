import type { SupabaseClient } from "@supabase/supabase-js";

// The group setting "Post-workout cards and PR notices": whether finishing a workout makes a feed card and a share card, whether a record is announced, and whether the weekly milestone celebrations go to athletes.
// groups.post_workout_cards is null until the coach chooses; null means the default, which depends on the group: OFF for a team-sport group (team_mode: the athletes are often managed on paper by their coach and
// have no phone to receive anything), ON for every other group. A session a coach logs, and a backfilled (imported) one, never makes a card whatever the setting says (callers decide that).
export function postWorkoutCardsOn(setting: boolean | null | undefined, teamMode: boolean | null | undefined): boolean {
  if (setting === true || setting === false) return setting;
  return !teamMode;
}

type Row = { id?: string; post_workout_cards?: boolean | null; team_mode?: boolean | null };

/** One group's setting. Tolerates a database that does not have the column yet (the default by team_mode then applies). A failed read gives the quiet answer for a team group and the usual one otherwise. */
export async function loadPostWorkoutCards(supabase: SupabaseClient, groupId: string): Promise<boolean> {
  const full = await supabase.from("groups").select("post_workout_cards, team_mode").eq("id", groupId).maybeSingle();
  if (!full.error) {
    const row = full.data as Row | null;
    return postWorkoutCardsOn(row?.post_workout_cards, row?.team_mode);
  }
  const plain = await supabase.from("groups").select("team_mode").eq("id", groupId).maybeSingle();
  return postWorkoutCardsOn(null, (plain.data as Row | null)?.team_mode);
}

/** Many groups at once: id -> whether cards are on. */
export async function loadPostWorkoutCardsMany(supabase: SupabaseClient, groupIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const ids = Array.from(new Set(groupIds.filter(Boolean)));
  if (ids.length === 0) return out;
  const full = await supabase.from("groups").select("id, post_workout_cards, team_mode").in("id", ids);
  if (!full.error) {
    for (const row of (full.data ?? []) as Row[]) out.set(row.id as string, postWorkoutCardsOn(row.post_workout_cards, row.team_mode));
    return out;
  }
  const plain = await supabase.from("groups").select("id, team_mode").in("id", ids);
  for (const row of (plain.data ?? []) as Row[]) out.set(row.id as string, postWorkoutCardsOn(null, row.team_mode));
  return out;
}
