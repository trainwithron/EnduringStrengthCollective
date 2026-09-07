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

// Looks up the progression rule for this exercise (if any), works out which
// occurrence `currentWorkoutId` is within the program, pulls the athlete's
// own logged performance at the reference/previous occurrences, and resolves
// a goal. Returns null when there's no rule — callers fall back to whatever
// they already show (e.g. the "Last time" hint).
export async function getProgressionGoal(
  supabase: any,
  {
    programId,
    exerciseName,
    athleteId,
    currentWorkoutId,
  }: { programId: string; exerciseName: string; athleteId: string; currentWorkoutId: string }
): Promise<ProgressionTarget | null> {
  const { data: rule } = await supabase
    .from("exercise_progressions")
    .select("model, config")
    .eq("program_id", programId)
    .eq("exercise_name", exerciseName)
    .maybeSingle();

  if (!rule) return null;

  const { data: occurrenceRows } = await supabase
    .from("group_workout_exercises")
    .select("workout_id, workouts!inner ( id, week_number, day_index, program_id )")
    .eq("exercise_name", exerciseName)
    .eq("workouts.program_id", programId);

  const occurrences = (occurrenceRows ?? [])
    .map((r: any) => ({
      workoutId: r.workout_id as string,
      weekNumber: r.workouts.week_number as number,
      dayIndex: r.workouts.day_index as number,
    }))
    .sort((a: any, b: any) => a.weekNumber - b.weekNumber || a.dayIndex - b.dayIndex);

  const occurrenceIndex = occurrences.findIndex((o: any) => o.workoutId === currentWorkoutId) + 1;
  if (occurrenceIndex <= 1) return null;

  const referenceWorkoutId = occurrences[0]?.workoutId;
  const previousWorkoutId = occurrences[occurrenceIndex - 2]?.workoutId;
  const neededWorkoutIds = Array.from(
    new Set([referenceWorkoutId, previousWorkoutId].filter(Boolean))
  );

  if (neededWorkoutIds.length === 0) return null;

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
    .eq("session_exercises.exercise_name", exerciseName)
    .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
    .in("session_exercises.athlete_sessions.workout_id", neededWorkoutIds)
    .eq("status", "completed");

  const bestByWorkout: Record<string, LoggedPerformance> = {};
  for (const row of (priorSets ?? []) as any[]) {
    const workoutId = row.session_exercises.athlete_sessions.workout_id as string;
    const weight = row.weight ?? 0;
    if (!bestByWorkout[workoutId] || weight > bestByWorkout[workoutId].weight) {
      bestByWorkout[workoutId] = { weight, reps: row.reps ?? 0 };
    }
  }

  const referenceLog = referenceWorkoutId ? bestByWorkout[referenceWorkoutId] ?? null : null;
  const previousOccurrenceLog = previousWorkoutId ? bestByWorkout[previousWorkoutId] ?? null : null;

  return resolveProgressionTarget({
    model: rule.model,
    config: rule.config,
    occurrenceIndex,
    referenceLog,
    previousOccurrenceLog,
  });
}
