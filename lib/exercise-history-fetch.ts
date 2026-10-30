import type { SupabaseClient } from "@supabase/supabase-js";
import { computeVolumeHistory, type VolumeHistoryPoint } from "@/lib/exercise-volume-history";

// An exercise swapped in or added mid-workout gets the same history a program exercise shows from the start (Ron, Oct 29: "it should link to the exercise history and everything"):
// "Last time" and the volume sparkline under its new name, from this person's other completed sessions. The same rows the workout page reads on load (app/sessions/[sessionId]/page.tsx).
export interface ExerciseHistory {
  lastTime: { weight: number; reps: number } | null;
  volumeHistory: VolumeHistoryPoint[];
}

export const EMPTY_HISTORY: ExerciseHistory = { lastTime: null, volumeHistory: [] };

export async function fetchExerciseHistory(
  supabase: SupabaseClient,
  opts: { athleteId: string; exerciseName: string; excludeSessionId: string }
): Promise<ExerciseHistory> {
  const { data, error } = await supabase
    .from("set_logs")
    .select(
      `
      weight, reps, completed_at,
      session_exercises!inner (
        exercise_name, session_id,
        athlete_sessions!inner ( athlete_id )
      )
    `
    )
    .eq("session_exercises.exercise_name", opts.exerciseName)
    .eq("session_exercises.athlete_sessions.athlete_id", opts.athleteId)
    .neq("session_exercises.session_id", opts.excludeSessionId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1000);
  if (error || !data) return EMPTY_HISTORY;
  return historyFromRows(data as any[]);
}

// Pure: newest first in, "Last time" is the newest set with both a weight and reps.
export function historyFromRows(
  rows: { weight: number | null; reps: number | null; completed_at: string | null; session_exercises: { session_id: string } }[]
): ExerciseHistory {
  const last = rows.find((r) => r.weight != null && r.reps != null);
  return {
    lastTime: last ? { weight: last.weight as number, reps: last.reps as number } : null,
    volumeHistory: computeVolumeHistory(
      rows.map((r) => ({ sessionId: r.session_exercises.session_id, completedAt: r.completed_at, weight: r.weight, reps: r.reps }))
    ),
  };
}
