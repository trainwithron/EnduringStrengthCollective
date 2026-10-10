import { createServerClient } from "@/lib/supabase/server";
import { ExerciseProgressionChart } from "@/components/coach/desktop/exercise-progression-chart";

// Every real logged set for this client, grouped into a per-exercise trend: no separate schema, every set already carries its own completed_at. It is the slowest
// query on the client's profile, so it loads here (behind a Suspense on the page) and the rest of the profile shows without waiting for it. Capped at 500 rows.
export async function ExerciseProgressionLoader({ athleteId, groupId }: { athleteId: string; groupId: string }) {
  const supabase = await createServerClient();
  const { data: exerciseHistoryRows } = await supabase
    .from("set_logs")
    .select("weight, completed_at, session_exercises!inner ( exercise_name, session_id, athlete_sessions!inner ( athlete_id, group_id ) )")
    .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
    .eq("session_exercises.athlete_sessions.group_id", groupId)
    .eq("status", "completed")
    .not("weight", "is", null)
    .order("completed_at", { ascending: true })
    .limit(500);

  const progressionByExercise = new Map<string, Map<string, number>>();
  for (const row of (exerciseHistoryRows ?? []) as any[]) {
    const name = row.session_exercises.exercise_name;
    const date = (row.completed_at as string).slice(0, 10);
    const weight = row.weight as number;
    const byDate = progressionByExercise.get(name) ?? new Map<string, number>();
    // Best set of the day per exercise, same "session best" convention PR detection already uses: several sets the same day collapse to one point.
    if (!byDate.has(date) || weight > byDate.get(date)!) {
      byDate.set(date, weight);
    }
    progressionByExercise.set(name, byDate);
  }
  const progressionData: Record<string, { date: string; value: number }[]> = {};
  for (const [name, byDate] of progressionByExercise) {
    progressionData[name] = Array.from(byDate.entries())
      .map(([date, value]) => ({ date, value }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  return <ExerciseProgressionChart progressionData={progressionData} />;
}
