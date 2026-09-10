import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseNumericReps,
  computeWeeklyVolumeSeries,
  bucketCategorySplit,
  type WeeklyVolumePoint,
  type CategorySplit,
} from "./program-card-visuals";

export interface ProgramCardVisualData {
  weeklySeries: WeeklyVolumePoint[];
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

  const { data: sets } = exerciseIds.length
    ? await supabase
        .from("group_workout_exercise_sets")
        .select("group_workout_exercise_id, target_weight, target_reps")
        .in("group_workout_exercise_id", exerciseIds)
    : { data: [] as any[] };

  // Planned volume per (program, week): sum(target_weight x parsed reps).
  // A set with a non-numeric rep target ("8-10", "AMRAP") or no weight
  // simply doesn't contribute — same silent-skip behavior as every other
  // volume estimate already in this app.
  const plannedByProgram = new Map<string, Map<number, number>>();
  for (const s of sets ?? []) {
    const workoutId = workoutIdByExerciseId.get(s.group_workout_exercise_id);
    if (!workoutId) continue;
    const programId = programByWorkoutId.get(workoutId);
    const week = weekByWorkoutId.get(workoutId);
    if (!programId || !week) continue;
    const reps = parseNumericReps(s.target_reps);
    if (!s.target_weight || !reps) continue;
    const programMap = plannedByProgram.get(programId) ?? new Map<number, number>();
    programMap.set(week, (programMap.get(week) ?? 0) + s.target_weight * reps);
    plannedByProgram.set(programId, programMap);
  }

  // Actual volume per (program, week): sum(workout_logs.total_volume) —
  // across every athlete who's logged against this program, for a
  // shared program run by several clients at once.
  const actualByProgram = new Map<string, Map<number, number>>();
  for (const log of logs ?? []) {
    const programId = programByWorkoutId.get(log.workout_id);
    const week = weekByWorkoutId.get(log.workout_id);
    if (!programId || !week) continue;
    const programMap = actualByProgram.get(programId) ?? new Map<number, number>();
    programMap.set(week, (programMap.get(week) ?? 0) + (log.total_volume ?? 0));
    actualByProgram.set(programId, programMap);
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
    const planned = plannedByProgram.get(programId) ?? new Map<number, number>();
    const actual = actualByProgram.get(programId) ?? new Map<number, number>();
    const weeklySeries = computeWeeklyVolumeSeries(planned, actual, weekCount);
    const categorySplit = bucketCategorySplit(categoryCountsByProgram.get(programId) ?? {});
    result.set(programId, { weeklySeries, categorySplit });
  }

  return result;
}
