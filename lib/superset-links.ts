import type { SupabaseClient } from "@supabase/supabase-js";

// Which exercises are linked with the next one (group_workout_exercises.superset_next, step 210). Read on their own and only the linked ones, so a program opens as before when the column is not
// there yet (no links) or the read fails, and the read stays small however big the program is.

/** The linked exercises of a program. */
export async function linkedExercisesOfProgram(supabase: SupabaseClient, programId: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from("group_workout_exercises").select("id, workouts!inner ( program_id )").eq("workouts.program_id", programId).eq("superset_next", true).limit(1000);
    if (error) return new Set();
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  } catch {
    return new Set();
  }
}

/** The linked exercises among these (a workout's programmed exercises). */
export async function linkedExercisesAmong(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const { data, error } = await supabase.from("group_workout_exercises").select("id").in("id", ids.slice(0, 200)).eq("superset_next", true);
    if (error) return new Set();
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  } catch {
    return new Set();
  }
}

// "Last time" for a client on each exercise of their program (Ron, Nov 20: B6): the weight and reps of the most recent completed set the client logged on that exercise, by name. One read of the
// client's most recent sets (the last thousand), so it never waits for the program to be read first; an exercise not done in that time has no line, and a read that fails leaves every line off.
export async function recentLastTimes(supabase: SupabaseClient, athleteId: string): Promise<Record<string, { weight: number; reps: number }>> {
  const out: Record<string, { weight: number; reps: number }> = {};
  try {
    const { data, error } = await supabase
      .from("set_logs")
      .select("weight, reps, completed_at, session_exercises!inner ( exercise_name, athlete_sessions!inner ( athlete_id ) )")
      .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
      .eq("status", "completed")
      .not("weight", "is", null)
      .not("reps", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1000);
    if (error) return out;
    for (const row of (data ?? []) as { weight: number; reps: number; session_exercises: { exercise_name: string } | { exercise_name: string }[] }[]) {
      const se = Array.isArray(row.session_exercises) ? row.session_exercises[0] : row.session_exercises;
      const name = se?.exercise_name;
      if (name && !(name in out)) out[name] = { weight: Number(row.weight), reps: row.reps };
    }
  } catch {
    // no lines
  }
  return out;
}

/** "Last time 135 × 8". */
export function lastTimeLine(last: { weight: number; reps: number } | null | undefined): string | null {
  if (!last) return null;
  return `Last time ${Number(last.weight.toFixed(2))} × ${last.reps}`;
}
