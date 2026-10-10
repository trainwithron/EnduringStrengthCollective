import { findCorrelatingWeightSuggestion, resolveWeightSuggestion } from "@/lib/set-suggestions";
import { parseNumericReps } from "@/lib/program-card-visuals";

// The gray weight a set shows before anything is typed: found in the athlete's real logged history (the most recent past set of the same exercise with the same target reps, or the
// same reps and RPE/RIR), reconciled with an explicit target weight on the set. ONE function, used by the client's workout screen AND by the coach's builder, so the two can never
// disagree about what is suggested for the same data.

export interface SuggestionExercise {
  exerciseName: string;
  sets: { id: string; targetReps: string | null; targetRpe: number | null; targetRir: number | null; targetWeight: number | null }[];
}

// The rows of the athlete's completed sets for these exercises, newest first, in the shape both callers fetch (see PRIOR_SETS_SELECT).
export const PRIOR_SETS_SELECT = `
        weight, reps, rpe, rir, set_order, completed_at,
        session_exercises!inner (
          exercise_name, group_workout_exercise_id,
          athlete_sessions!inner ( athlete_id )
        )
      `;

// Which template each logged set was logged against is needed to recover that set's OWN target reps/RPE/RIR: one batched read for every distinct template exercise in the history.
export async function suggestedWeightsFromHistory(
  supabase: any,
  exercises: SuggestionExercise[],
  priorRows: any[]
): Promise<Map<string, number>> {
  const templateExerciseIds = Array.from(
    new Set(priorRows.map((r) => r.session_exercises.group_workout_exercise_id as string | null).filter((id): id is string => !!id))
  );
  const { data: historicalTargetRows } =
    templateExerciseIds.length > 0
      ? await supabase
          .from("group_workout_exercise_sets")
          .select("group_workout_exercise_id, set_order, target_reps, target_rpe, target_rir")
          .in("group_workout_exercise_id", templateExerciseIds)
      : { data: [] as any[] };

  const targetByExerciseAndOrder = new Map<string, { targetReps: number | null; targetRpe: number | null; targetRir: number | null }>();
  for (const row of (historicalTargetRows ?? []) as any[]) {
    targetByExerciseAndOrder.set(`${row.group_workout_exercise_id}::${row.set_order}`, {
      targetReps: parseNumericReps(row.target_reps),
      targetRpe: row.target_rpe,
      targetRir: row.target_rir,
    });
  }

  const historyByExerciseName = new Map<
    string,
    { loggedAt: string; weight: number | null; targetReps: number | null; targetRpe: number | null; targetRir: number | null }[]
  >();
  for (const row of priorRows) {
    const name = row.session_exercises.exercise_name as string;
    const templateId = row.session_exercises.group_workout_exercise_id as string | null;
    const targets = templateId ? targetByExerciseAndOrder.get(`${templateId}::${row.set_order}`) : undefined;
    const list = historyByExerciseName.get(name) ?? [];
    list.push({
      loggedAt: row.completed_at,
      weight: row.weight,
      targetReps: targets?.targetReps ?? null,
      targetRpe: targets?.targetRpe ?? row.rpe ?? null,
      targetRir: targets?.targetRir ?? row.rir ?? null,
    });
    historyByExerciseName.set(name, list);
  }

  const suggestedWeightBySetId = new Map<string, number>();
  for (const ex of exercises) {
    const history = historyByExerciseName.get(ex.exerciseName) ?? [];
    for (const set of ex.sets) {
      const currentTargetReps = parseNumericReps(set.targetReps);
      const correlatingMatch = findCorrelatingWeightSuggestion(history, currentTargetReps, set.targetRpe, set.targetRir);
      const suggestion = resolveWeightSuggestion(correlatingMatch, set.targetWeight);
      if (suggestion != null) suggestedWeightBySetId.set(set.id, suggestion);
    }
  }
  return suggestedWeightBySetId;
}
