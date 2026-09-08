export type ProgressionModel = "linear" | "wave" | "double_progression";
export type ProgressionUnit = "lbs" | "percent";

export interface LinearConfig {
  weightIncrement: number;
  repIncrement: number;
  unit: ProgressionUnit;
}

export interface WaveConfig {
  weightDeltas: number[];
  repsPattern: number[];
  unit: ProgressionUnit;
}

export interface DoubleProgressionConfig {
  repRangeLow: number;
  repRangeHigh: number;
  weightIncrement: number;
  unit: ProgressionUnit;
}

export type ProgressionConfig = LinearConfig | WaveConfig | DoubleProgressionConfig;

export interface LoggedPerformance {
  weight: number;
  reps: number;
}

export interface ProgressionTarget {
  weight: number | null;
  reps: number | null;
}

function applyUnit(base: number, delta: number, unit: ProgressionUnit): number {
  const result = unit === "percent" ? base * (1 + delta / 100) : base + delta;
  return Math.round(result * 100) / 100;
}

// Pure math — no I/O. occurrenceIndex is 1-based: occurrence 1 is the
// reference the athlete sets themselves, so it never has a computed goal.
export function resolveProgressionTarget({
  model,
  config,
  occurrenceIndex,
  referenceLog,
  previousOccurrenceLog,
}: {
  model: ProgressionModel;
  config: ProgressionConfig;
  occurrenceIndex: number;
  referenceLog: LoggedPerformance | null;
  previousOccurrenceLog: LoggedPerformance | null;
}): ProgressionTarget {
  if (occurrenceIndex <= 1) {
    return { weight: null, reps: null };
  }

  switch (model) {
    case "linear": {
      if (!referenceLog) return { weight: null, reps: null };
      const { weightIncrement, repIncrement, unit } = config as LinearConfig;
      const steps = occurrenceIndex - 1;
      return {
        weight: applyUnit(referenceLog.weight, weightIncrement * steps, unit),
        reps: referenceLog.reps + repIncrement * steps,
      };
    }
    case "wave": {
      if (!referenceLog) return { weight: null, reps: null };
      const { weightDeltas, repsPattern, unit } = config as WaveConfig;
      const weight =
        weightDeltas.length > 0
          ? applyUnit(referenceLog.weight, weightDeltas[(occurrenceIndex - 1) % weightDeltas.length], unit)
          : referenceLog.weight;
      const reps =
        repsPattern.length > 0
          ? repsPattern[(occurrenceIndex - 1) % repsPattern.length]
          : referenceLog.reps;
      return { weight, reps };
    }
    case "double_progression": {
      if (!previousOccurrenceLog) return { weight: null, reps: null };
      const { repRangeLow, repRangeHigh, weightIncrement, unit } = config as DoubleProgressionConfig;
      if (previousOccurrenceLog.reps >= repRangeHigh) {
        return {
          weight: applyUnit(previousOccurrenceLog.weight, weightIncrement, unit),
          reps: repRangeLow,
        };
      }
      return {
        weight: previousOccurrenceLog.weight,
        reps: Math.min(previousOccurrenceLog.reps + 1, repRangeHigh),
      };
    }
    default:
      return { weight: null, reps: null };
  }
}

// Batched sibling of getProgressionGoal below — resolves every exercise
// slot in a workout in 3 total queries instead of up to 3 per exercise.
// A workout page with 8 exercises previously fired ~24 sequential-per-
// branch queries just to compute progression goals; this fires 3 total,
// regardless of exercise count. Produces byte-identical results to calling
// getProgressionGoal once per exercise — same rule lookup, same
// occurrence-index math, same "best (highest-weight) completed set per
// workout" resolution, just fetched in bulk and joined in memory.
export async function getProgressionGoalsBatch(
  supabase: any,
  {
    programId,
    athleteId,
    currentWorkoutId,
    exercises,
  }: {
    programId: string;
    athleteId: string;
    currentWorkoutId: string;
    exercises: { slotId: string; exerciseName: string; loggedExerciseName?: string }[];
  }
): Promise<Map<string, ProgressionTarget>> {
  const result = new Map<string, ProgressionTarget>();
  if (exercises.length === 0) return result;

  const templateNames = Array.from(new Set(exercises.map((e) => e.exerciseName)));

  const { data: rules } = await supabase
    .from("exercise_progressions")
    .select("exercise_name, model, config")
    .eq("program_id", programId)
    .in("exercise_name", templateNames);

  const ruleByName = new Map<string, { model: ProgressionModel; config: ProgressionConfig }>(
    (rules ?? []).map((r: any) => [r.exercise_name, { model: r.model, config: r.config }])
  );

  const namesWithRules = exercises.filter((e) => ruleByName.has(e.exerciseName));
  if (namesWithRules.length === 0) return result;

  const uniqueNamesWithRules = Array.from(new Set(namesWithRules.map((e) => e.exerciseName)));

  const { data: occurrenceRows } = await supabase
    .from("group_workout_exercises")
    .select("exercise_name, workout_id, workouts!inner ( id, week_number, day_index, program_id )")
    .in("exercise_name", uniqueNamesWithRules)
    .eq("workouts.program_id", programId);

  const occurrencesByName = new Map<
    string,
    { workoutId: string; weekNumber: number; dayIndex: number }[]
  >();
  for (const row of (occurrenceRows ?? []) as any[]) {
    const list = occurrencesByName.get(row.exercise_name) ?? [];
    list.push({
      workoutId: row.workout_id,
      weekNumber: row.workouts.week_number,
      dayIndex: row.workouts.day_index,
    });
    occurrencesByName.set(row.exercise_name, list);
  }
  for (const list of occurrencesByName.values()) {
    list.sort((a, b) => a.weekNumber - b.weekNumber || a.dayIndex - b.dayIndex);
  }

  interface Resolved {
    slotId: string;
    performanceName: string;
    model: ProgressionModel;
    config: ProgressionConfig;
    occurrenceIndex: number;
    referenceWorkoutId?: string;
    previousWorkoutId?: string;
  }
  const resolved: Resolved[] = [];
  const allNeededWorkoutIds = new Set<string>();
  const allNeededNames = new Set<string>();

  for (const ex of namesWithRules) {
    const rule = ruleByName.get(ex.exerciseName)!;
    const occurrences = occurrencesByName.get(ex.exerciseName) ?? [];
    const occurrenceIndex = occurrences.findIndex((o) => o.workoutId === currentWorkoutId) + 1;
    if (occurrenceIndex <= 1) continue;

    const referenceWorkoutId = occurrences[0]?.workoutId;
    const previousWorkoutId = occurrences[occurrenceIndex - 2]?.workoutId;
    if (!referenceWorkoutId && !previousWorkoutId) continue;

    const performanceName = ex.loggedExerciseName ?? ex.exerciseName;
    if (referenceWorkoutId) allNeededWorkoutIds.add(referenceWorkoutId);
    if (previousWorkoutId) allNeededWorkoutIds.add(previousWorkoutId);
    allNeededNames.add(performanceName);

    resolved.push({
      slotId: ex.slotId,
      performanceName,
      model: rule.model,
      config: rule.config,
      occurrenceIndex,
      referenceWorkoutId,
      previousWorkoutId,
    });
  }

  if (resolved.length === 0 || allNeededWorkoutIds.size === 0) return result;

  const { data: priorSets } = await supabase
    .from("set_logs")
    .select(
      `
      weight, reps,
      session_exercises!inner (
        exercise_name,
        athlete_sessions!inner ( athlete_id, workout_id )
      )
    `
    )
    .in("session_exercises.exercise_name", Array.from(allNeededNames))
    .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
    .in("session_exercises.athlete_sessions.workout_id", Array.from(allNeededWorkoutIds))
    .eq("status", "completed");

  // Best (highest-weight) completed log per (exercise name, workout) pair —
  // scoped by the compound key so different exercises' logs never mix.
  const bestByNameAndWorkout = new Map<string, LoggedPerformance>();
  for (const row of (priorSets ?? []) as any[]) {
    const name = row.session_exercises.exercise_name as string;
    const workoutId = row.session_exercises.athlete_sessions.workout_id as string;
    const key = `${name}::${workoutId}`;
    const weight = row.weight ?? 0;
    const existing = bestByNameAndWorkout.get(key);
    if (!existing || weight > existing.weight) {
      bestByNameAndWorkout.set(key, { weight, reps: row.reps ?? 0 });
    }
  }

  for (const r of resolved) {
    const referenceLog = r.referenceWorkoutId
      ? bestByNameAndWorkout.get(`${r.performanceName}::${r.referenceWorkoutId}`) ?? null
      : null;
    const previousOccurrenceLog = r.previousWorkoutId
      ? bestByNameAndWorkout.get(`${r.performanceName}::${r.previousWorkoutId}`) ?? null
      : null;

    const target = resolveProgressionTarget({
      model: r.model,
      config: r.config,
      occurrenceIndex: r.occurrenceIndex,
      referenceLog,
      previousOccurrenceLog,
    });
    if (target.weight != null || target.reps != null) {
      result.set(r.slotId, target);
    }
  }

  return result;
}

// The single-exercise version of the lookup above was superseded by
// getProgressionGoalsBatch (same math, batched across every exercise in a
// workout instead of one query-set per exercise) once its only caller
// (getWorkoutOverviewData) switched over — removed rather than left as
// unused dead code.
