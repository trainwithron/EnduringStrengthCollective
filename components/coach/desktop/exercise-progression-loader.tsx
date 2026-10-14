import { createServerClient } from "@/lib/supabase/server";
import { ExerciseProgressionChart } from "@/components/coach/desktop/exercise-progression-chart";
import { dailyBestByExercise, parseRollup } from "@/lib/imported-prs";

// The best weight of each day for every exercise this client has done, imported history included (an unclear imported point is never in it), as one per-exercise trend. It reads the same
// rolled-up rows as the stats, one row per workout and exercise, so a long history is no longer cut off at the oldest 500 sets. It loads here (behind a Suspense on the page) so the rest of
// the profile shows without waiting for it.
export async function ExerciseProgressionLoader({ athleteId, groupId }: { athleteId: string; groupId: string }) {
  const supabase = await createServerClient();
  const { data: rollupRows } = await supabase.rpc("client_exercise_rollup", { p_athlete: athleteId, p_group: groupId });
  return <ExerciseProgressionChart progressionData={dailyBestByExercise(parseRollup(rollupRows))} />;
}
