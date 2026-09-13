import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseNumericReps,
  computeWeeklyVolumeSeries,
  bucketCategorySplit,
  type WeeklyVolumePoint,
  type CategorySplit,
} from "./program-card-visuals";

export interface ProgramCardVisualData {
  // Primary — always shown. Real, available data at plan-preview time
  // regardless of whether a coach ever filled in target weights: sum of
  // prescribed reps per week (planned) vs. real completed reps per week
  // (actual). Weight-based volume, below, is a real signal too, but it's
  // usually zero/missing before any workout is actually logged, which is
  // exactly why it's demoted to secondary rather than the graph's driver.
  repsSeries: WeeklyVolumePoint[];
  // Secondary, layered on top of the same chart — null (not an empty
  // array) when this program has no real weight data at all yet, so the
  // component can skip drawing a flat, meaningless line.
  weightSeries: WeeklyVolumePoint[] | null;
  categorySplit: CategorySplit;
}

// Batches every query needed to render program-card visuals for a whole
// page of cards into a handful of `in()` calls — not one query per card.
// A program with zero workouts simply gets no entry in the returned map;
// callers fall back to the plain placeholder for those.
export async function computeProgramCardVisuals(
  supabase: SupabaseClient,
  programIds: string[],
  coachId: string
): Promise<Map<string, ProgramCardVisualData>> {
  const result = new Map<string, ProgramCardVisualData>();
  if (programIds.length === 0) return result;

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, program_id, week_number")
    .in("program_id", programIds);

  if (!workouts || workouts.length === 0) return result;

  const workoutIds = workouts.map((w) => w.id);
  const weekByWorkoutId = new Map(workouts.map((w) => [w.id, w.week_number as number]));
  const programByWorkoutId = new Map(workouts.map((w) => [w.id, w.program_id as string]));

  const [{ data: exercises }, { data: logs }, { data: libraryRows }] = await Promise.all([
    supabase
      .from("group_workout_exercises")
      .select("id, workout_id, exercise_name")
      .in("workout_id", workoutIds),
    supabase.from("workout_logs").select("workout_id, total_volume").in("workout_id", workoutIds),
    supabase.from("exercise_library").select("name, category").eq("created_by", coachId),
  ]);

  const categoryByName = new Map((libraryRows ?? []).map((r) => [r.name as string, r.category as string | null]));
  const workoutIdByExerciseId = new Map((exercises ?? []).map((e) => [e.id as string, e.workout_id as string]));
  const exerciseIds = (exercises ?? []).map((e) => e.id as string);

  const [{ data: sets }, { data: completedSetLogs }] = await Promise.all([
    exerciseIds.length
      ? supabase
          .from("group_workout_exercise_sets")
          .select("group_workout_exercise_id, target_weight, target_reps")
          .in("group_workout_exercise_id", exerciseIds)
      : Promise.resolve({ data: [] as any[] }),
    // Real completed reps, for the primary (weight-free) series — joined
    // through session_exercises rather than workout_logs, since a
    // workout_log row only carries a weighted total, never a rep count.
    exerciseIds.length
      ? supabase
          .from("set_logs")
          .select("reps, session_exercises!inner ( group_workout_exercise_id )")
          .eq("status", "completed")
          .in("session_exercises.group_workout_exercise_id", exerciseIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  // Planned reps per (program, week): sum(parsed reps), regardless of
  // whether a target weight was ever set — real, available data at
  // plan-preview time, which is exactly what a weight-based estimate
  // isn't (see ProgramCardVisualData's own comment).
  const plannedRepsByProgram = new Map<string, Map<number, number>>();
  // Planned volume (weight x reps) per (program, week) — the secondary
  // series. A set with a non-numeric rep target ("8-10", "AMRAP") or no
  // weight simply doesn't contribute to this one, same silent-skip
  // behavior as every other volume estimate already in this app.
  const plannedVolumeByProgram = new Map<string, Map<number, number>>();
  for (const s of sets ?? []) {
    const workoutId = workoutIdByExerciseId.get(s.group_workout_exercise_id);
    if (!workoutId) continue;
    const programId = programByWorkoutId.get(workoutId);
    const week = weekByWorkoutId.get(workoutId);
    if (!programId || !week) continue;
    const reps = parseNumericReps(s.target_reps);
    if (reps) {
      const repsMap = plannedRepsByProgram.get(programId) ?? new Map<number, number>();
      repsMap.set(week, (repsMap.get(week) ?? 0) + reps);
      plannedRepsByProgram.set(programId, repsMap);
    }
    if (s.target_weight && reps) {
      const volumeMap = plannedVolumeByProgram.get(programId) ?? new Map<number, number>();
      volumeMap.set(week, (volumeMap.get(week) ?? 0) + s.target_weight * reps);
      plannedVolumeByProgram.set(programId, volumeMap);
    }
  }

  // Actual reps per (program, week): sum(set_logs.reps) for real completed
  // sets — the primary series' actual line.
  const actualRepsByProgram = new Map<string, Map<number, number>>();
  for (const row of (completedSetLogs ?? []) as any[]) {
    const exerciseId = row.session_exercises?.group_workout_exercise_id;
    const workoutId = exerciseId ? workoutIdByExerciseId.get(exerciseId) : undefined;
    if (!workoutId || !row.reps) continue;
    const programId = programByWorkoutId.get(workoutId);
    const week = weekByWorkoutId.get(workoutId);
    if (!programId || !week) continue;
    const programMap = actualRepsByProgram.get(programId) ?? new Map<number, number>();
    programMap.set(week, (programMap.get(week) ?? 0) + row.reps);
    actualRepsByProgram.set(programId, programMap);
  }

  // Actual volume per (program, week): sum(workout_logs.total_volume) —
  // across every athlete who's logged against this program, for a
  // shared program run by several clients at once. The secondary series'
  // actual line.
  const actualVolumeByProgram = new Map<string, Map<number, number>>();
  for (const log of logs ?? []) {
    const programId = programByWorkoutId.get(log.workout_id);
    const week = weekByWorkoutId.get(log.workout_id);
    if (!programId || !week) continue;
    const programMap = actualVolumeByProgram.get(programId) ?? new Map<number, number>();
    programMap.set(week, (programMap.get(week) ?? 0) + (log.total_volume ?? 0));
    actualVolumeByProgram.set(programId, programMap);
  }

  // Category counts per program, from this coach's own exercise_library.
  const categoryCountsByProgram = new Map<string, Record<string, number>>();
  for (const e of exercises ?? []) {
    const programId = programByWorkoutId.get(e.workout_id);
    if (!programId) continue;
    const category = categoryByName.get(e.exercise_name);
    if (!category) continue;
    const counts = categoryCountsByProgram.get(programId) ?? {};
    counts[category] = (counts[category] ?? 0) + 1;
    categoryCountsByProgram.set(programId, counts);
  }

  // The max week_number seen defines how many weeks the sparkline spans
  // — a week with real workouts but zero planned/logged volume (a
  // deload/rest week) still plots as a real 0, correctly distinct from a
  // week that's simply out of the program's range.
  const maxWeekByProgram = new Map<string, number>();
  for (const w of workouts) {
    const current = maxWeekByProgram.get(w.program_id as string) ?? 0;
    if ((w.week_number as number) > current) maxWeekByProgram.set(w.program_id as string, w.week_number as number);
  }

  for (const programId of programIds) {
    const weekCount = maxWeekByProgram.get(programId);
    if (!weekCount) continue;

    const plannedReps = plannedRepsByProgram.get(programId) ?? new Map<number, number>();
    const actualReps = actualRepsByProgram.get(programId) ?? new Map<number, number>();
    const repsSeries = computeWeeklyVolumeSeries(plannedReps, actualReps, weekCount);

    const plannedVolume = plannedVolumeByProgram.get(programId);
    const actualVolume = actualVolumeByProgram.get(programId);
    // Only build the secondary weight series once real weight data exists
    // somewhere — a program with no target weights ever set and nothing
    // logged yet has nothing meaningful to layer on top.
    const weightSeries =
      (plannedVolume && plannedVolume.size > 0) || (actualVolume && actualVolume.size > 0)
        ? computeWeeklyVolumeSeries(plannedVolume ?? new Map(), actualVolume ?? new Map(), weekCount)
        : null;

    const categorySplit = bucketCategorySplit(categoryCountsByProgram.get(programId) ?? {});
    result.set(programId, { repsSeries, weightSeries, categorySplit });
  }

  return result;
}
