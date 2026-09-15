// dup_gzclp_build_spec_sept15.md §2.3 Path B — wave_from_training_max is
// the wave model, but seeded from the athlete's persisted training max
// (athlete_training_maxes.estimated_max) instead of their own first
// logged occurrence inside this program. Every occurrence becomes
// dynamically computed forever, self-updating the moment a new PR
// lands — no "regenerate the program" concept needed at all, unlike
// DUP Path A's one-shot precompute.
export type ProgressionModel =
  | "linear"
  | "wave"
  | "double_progression"
  | "gzclp_t1"
  | "wave_from_training_max";
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

// dup_gzclp_build_spec_sept15.md §1.2 — GZCLP's T1 tier. startingWeight
// exists because, unlike the other 3 models, T1 has no self-referential
// occurrence-1 log to anchor from at generation time (the shell is
// generated before the athlete has logged anything against it).
export interface GzclpT1Config {
  startingWeight: number;
  weightIncrement: number;
  unit: ProgressionUnit;
  deloadPercent: number;
}

export type ProgressionConfig = LinearConfig | WaveConfig | DoubleProgressionConfig | GzclpT1Config;

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

// The real GZCLP T1 cascade — fail the AMRAP-set minimum at a given
// stage and you drop to the next (harder-notation, same weight) stage;
// succeed and you add weight, staying at the same stage. Only failing
// Stage 3 triggers an actual weight reset. This is a real, load-bearing
// detail: T1's "reset" is NOT "3 failures in a row at one rep scheme" —
// get it backwards and the generated program reads as subtly wrong to
// anyone who knows GZCLP.
export const GZCLP_T1_STAGES = [
  { label: "5x3+", minReps: 3 },
  { label: "6x2+", minReps: 2 },
  { label: "10x1+", minReps: 1 },
] as const;

export interface GzclpT1Occurrence {
  occurrenceIndex: number; // 1-based
  // The AMRAP (final) set's logged reps for that occurrence — NOT the
  // highest-weight set (getProgressionGoalsBatch's usual tiebreak is
  // meaningless here, since every set at a T1 occurrence is the same
  // weight; this needs the set at the highest set_order instead).
  amrapReps: number | null;
}

export interface GzclpT1Target extends ProgressionTarget {
  stage: number; // 1-3, for display
  stageLabel: string; // "5x3+" / "6x2+" / "10x1+"
}

// Pure math — no I/O. Unlike resolveProgressionTarget's two-point
// (reference + previous) signature, T1's stage can only be determined
// by replaying every occurrence since the last reset (or since
// occurrence 1) — a single prior point isn't enough to know which of
// the 3 stages currently applies. Occurrence 1 deliberately returns a
// real target (not null) — startingWeight exists specifically to seed
// it, since there's no logged set to reference yet at generation time.
export function resolveGzclpT1Target({
  config,
  occurrenceIndex,
  history,
}: {
  config: GzclpT1Config;
  occurrenceIndex: number;
  history: GzclpT1Occurrence[];
}): GzclpT1Target {
  let stage = 0;
  let weight = config.startingWeight;

  const priorOccurrences = history
    .filter((h) => h.occurrenceIndex < occurrenceIndex && h.amrapReps != null)
    .sort((a, b) => a.occurrenceIndex - b.occurrenceIndex);

  for (const occ of priorOccurrences) {
    const passed = occ.amrapReps! >= GZCLP_T1_STAGES[stage].minReps;
    if (passed) {
      weight = applyUnit(weight, config.weightIncrement, config.unit);
    } else if (stage < GZCLP_T1_STAGES.length - 1) {
      stage += 1;
    } else {
      weight = applyUnit(weight, -Math.abs(config.deloadPercent), "percent");
      stage = 0;
    }
  }

  return {
    weight: Math.round(weight * 100) / 100,
    reps: GZCLP_T1_STAGES[stage].minReps,
    stage: stage + 1,
    stageLabel: GZCLP_T1_STAGES[stage].label,
  };
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
  // wave_from_training_max's referenceLog comes from the persisted
  // training max, not a logged set inside this program — it's always
  // available from occurrence 1 onward, so unlike the other 3 models it
  // doesn't need a real prior occurrence to anchor from.
  if (model !== "wave_from_training_max" && occurrenceIndex <= 1) {
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
    case "wave":
    case "wave_from_training_max": {
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

  // gzclp_t1 needs its own path — unlike the 3 two-point models, its
  // target depends on the FULL occurrence history since the last reset,
  // not just the immediately-previous one, and it needs the AMRAP
  // (last-set_order) reps rather than the highest-weight set. Also, it
  // deliberately does NOT skip occurrence 1 — config.startingWeight
  // exists specifically to give it a real target with no prior log.
  interface ResolvedT1 {
    slotId: string;
    performanceName: string;
    config: GzclpT1Config;
    occurrenceIndex: number;
    priorWorkoutIds: string[]; // occurrences 1..occurrenceIndex-1, in order
  }
  const resolvedT1: ResolvedT1[] = [];
  const t1NeededWorkoutIds = new Set<string>();
  const t1NeededNames = new Set<string>();

  // dup_gzclp_build_spec_sept15.md §2.3 Path B — same reasoning as T1's
  // own occurrence-1 exception: the reference comes from
  // athlete_training_maxes, not a logged set in this program, so it's
  // available immediately, no history to wait on.
  interface ResolvedWaveFromTM {
    slotId: string;
    performanceName: string;
    config: WaveConfig;
    occurrenceIndex: number;
  }
  const resolvedWaveFromTM: ResolvedWaveFromTM[] = [];
  const waveFromTMNeededNames = new Set<string>();

  for (const ex of namesWithRules) {
    const rule = ruleByName.get(ex.exerciseName)!;
    const occurrences = occurrencesByName.get(ex.exerciseName) ?? [];
    const occurrenceIndex = occurrences.findIndex((o) => o.workoutId === currentWorkoutId) + 1;
    if (occurrenceIndex < 1) continue;

    const performanceName = ex.loggedExerciseName ?? ex.exerciseName;

    if (rule.model === "gzclp_t1") {
      const priorWorkoutIds = occurrences.slice(0, occurrenceIndex - 1).map((o) => o.workoutId);
      for (const id of priorWorkoutIds) t1NeededWorkoutIds.add(id);
      if (priorWorkoutIds.length > 0) t1NeededNames.add(performanceName);
      resolvedT1.push({
        slotId: ex.slotId,
        performanceName,
        config: rule.config as GzclpT1Config,
        occurrenceIndex,
        priorWorkoutIds,
      });
      continue;
    }

    if (rule.model === "wave_from_training_max") {
      waveFromTMNeededNames.add(performanceName);
      resolvedWaveFromTM.push({
        slotId: ex.slotId,
        performanceName,
        config: rule.config as WaveConfig,
        occurrenceIndex,
      });
      continue;
    }

    if (occurrenceIndex <= 1) continue;

    const referenceWorkoutId = occurrences[0]?.workoutId;
    const previousWorkoutId = occurrences[occurrenceIndex - 2]?.workoutId;
    if (!referenceWorkoutId && !previousWorkoutId) continue;

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

  // gzclp_t1 resolution — separate query keyed by set_order (the AMRAP
  // set is the LAST set in the occurrence, not the highest-weight one;
  // every T1 set is prescribed at the same weight, so "highest weight"
  // is meaningless here).
  if (resolvedT1.length > 0) {
    const t1Query =
      t1NeededWorkoutIds.size > 0
        ? await supabase
            .from("set_logs")
            .select(
              `
              reps, set_order,
              session_exercises!inner (
                exercise_name,
                athlete_sessions!inner ( athlete_id, workout_id )
              )
            `
            )
            .in("session_exercises.exercise_name", Array.from(t1NeededNames))
            .eq("session_exercises.athlete_sessions.athlete_id", athleteId)
            .in("session_exercises.athlete_sessions.workout_id", Array.from(t1NeededWorkoutIds))
            .eq("status", "completed")
        : { data: [] };

    // Last (highest set_order) completed set per (exercise name, workout) —
    // the AMRAP set.
    const amrapByNameAndWorkout = new Map<string, number>();
    const bestOrderSeen = new Map<string, number>();
    for (const row of (t1Query.data ?? []) as any[]) {
      const name = row.session_exercises.exercise_name as string;
      const workoutId = row.session_exercises.athlete_sessions.workout_id as string;
      const key = `${name}::${workoutId}`;
      const order = row.set_order ?? 0;
      if (!bestOrderSeen.has(key) || order > bestOrderSeen.get(key)!) {
        bestOrderSeen.set(key, order);
        amrapByNameAndWorkout.set(key, row.reps ?? 0);
      }
    }

    for (const r of resolvedT1) {
      const history: GzclpT1Occurrence[] = r.priorWorkoutIds.map((workoutId, i) => ({
        occurrenceIndex: i + 1,
        amrapReps: amrapByNameAndWorkout.get(`${r.performanceName}::${workoutId}`) ?? null,
      }));
      const target = resolveGzclpT1Target({
        config: r.config,
        occurrenceIndex: r.occurrenceIndex,
        history,
      });
      result.set(r.slotId, { weight: target.weight, reps: target.reps });
    }
  }

  // wave_from_training_max resolution — no set_logs query needed at
  // all; the reference point is athlete_training_maxes, sourced once
  // per exercise name rather than per occurrence.
  if (resolvedWaveFromTM.length > 0) {
    const { data: tmRows } = await supabase
      .from("athlete_training_maxes")
      .select("exercise_name, estimated_max")
      .eq("athlete_id", athleteId)
      .in("exercise_name", Array.from(waveFromTMNeededNames));

    const trainingMaxByName = new Map<string, number>(
      (tmRows ?? []).map((r: any) => [r.exercise_name as string, r.estimated_max as number])
    );

    for (const r of resolvedWaveFromTM) {
      const trainingMax = trainingMaxByName.get(r.performanceName);
      // Never invents a number — an athlete with no persisted training
      // max for this exercise just gets no suggestion, same as any
      // other model with nothing to reference from.
      if (trainingMax == null) continue;
      const target = resolveProgressionTarget({
        model: "wave_from_training_max",
        config: r.config,
        occurrenceIndex: r.occurrenceIndex,
        referenceLog: { weight: trainingMax, reps: 1 },
        previousOccurrenceLog: null,
      });
      if (target.weight != null || target.reps != null) {
        result.set(r.slotId, target);
      }
    }
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
