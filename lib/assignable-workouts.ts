import type { SupabaseClient } from "@supabase/supabase-js";

// The workouts a coach may put on a client's day ("assign a specific workout"). Only workouts the CLIENT can actually open: from their own program or a shared one, never an unsigned AI draft,
// a removed program, another client's personal program, or the coach's hidden template in a one-on-one space. Offering those made the client's Today a dead link.
export interface WorkoutOption {
  id: string;
  label: string;
}

interface Row {
  id: string;
  title: string;
  week_number: number;
  day_index: number;
  programs: { name: string; ai_draft: boolean | null; archived_at: string | null; athlete_id: string | null } | null;
}

export function filterAssignableWorkouts(rows: Row[], athleteId: string, oneOnOne: boolean): WorkoutOption[] {
  return rows
    .filter((w) => {
      const p = w.programs;
      if (!p) return false;
      if (p.ai_draft === true || p.archived_at) return false;
      if (p.athlete_id === athleteId) return true;
      return p.athlete_id === null && !oneOnOne;
    })
    .map((w) => ({
      id: w.id,
      label: `${w.programs?.name ?? "Program"} — Wk ${w.week_number} Day ${w.day_index + 1}: ${w.title}`,
    }));
}

export async function loadAssignableWorkouts(supabase: SupabaseClient, groupId: string, athleteId: string): Promise<WorkoutOption[]> {
  const [{ data }, { data: group }] = await Promise.all([
    supabase
      .from("workouts")
      .select("id, title, week_number, day_index, programs ( name, ai_draft, archived_at, athlete_id )")
      .eq("group_id", groupId)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true }),
    supabase.from("groups").select("group_kind").eq("id", groupId).maybeSingle(),
  ]);
  const oneOnOne = (group as { group_kind?: string | null } | null)?.group_kind === "one_on_one";
  return filterAssignableWorkouts((data ?? []) as unknown as Row[], athleteId, oneOnOne);
}
