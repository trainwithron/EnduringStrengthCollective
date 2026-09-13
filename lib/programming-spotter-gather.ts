// Programming Spotter — data-orchestration layer (real Supabase queries,
// no unit tests of its own, same convention as lib/coach-briefing-gather.ts
// and lib/dashboard-data.ts — only the pure lib/programming-spotter.ts
// functions it calls are tested).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectVolumeConcentration,
  detectRedundancy,
  detectFlatRepeat,
  detectMissingPatternCoverage,
  type SpotterExerciseEntry,
  type SpotterCategory,
  type SpotterTier,
  type FlatRepeatEntry,
} from "./programming-spotter";

export interface SpotterFlag {
  checkKind: "volume_concentration" | "redundancy" | "flat_repeat" | "missing_pattern";
  patternKey: string;
  headline: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  Push: "Push",
  Pull: "Pull",
  Legs: "Legs",
  Core: "Core",
  "Full Body": "Full Body",
  Cardio: "Cardio",
  Mobility: "Mobility",
};

export async function gatherProgrammingSpotterFlags(
  supabase: SupabaseClient,
  params: { programId: string; programName: string; coachId: string }
): Promise<SpotterFlag[]> {
  const { programId, programName, coachId } = params;

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, week_number")
    .eq("program_id", programId);
  if (!workouts || workouts.length === 0) return [];

  const weekByWorkoutId = new Map(workouts.map((w) => [w.id, w.week_number as number]));
  const workoutIds = workouts.map((w) => w.id);

  const { data: exerciseRows } = await supabase
    .from("group_workout_exercises")
    .select(
      "id, workout_id, exercise_name, exercise_order, group_workout_exercise_sets ( set_order, target_reps, target_weight, target_rpe, target_rir, target_tempo, target_time_seconds, target_height, target_distance )"
    )
    .in("workout_id", workoutIds);

  if (!exerciseRows || exerciseRows.length === 0) return [];

  const exerciseNames = [...new Set(exerciseRows.map((e) => e.exercise_name as string))];

  const [{ data: libraryRows }, { data: tierRows }] = await Promise.all([
    supabase.from("exercise_library").select("name, category").eq("created_by", coachId).in("name", exerciseNames),
    supabase
      .from("movement_pattern_exercises")
      .select("exercise_name, movement_pattern_id, tier, movement_patterns!inner ( created_by )")
      .eq("movement_patterns.created_by", coachId)
      .in("exercise_name", exerciseNames),
  ]);

  const categoryByName = new Map((libraryRows ?? []).map((r) => [r.name as string, r.category as SpotterCategory | null]));
  const tierByName = new Map<string, { movementPatternId: string; tier: SpotterTier | null }>();
  for (const row of (tierRows ?? []) as any[]) {
    if (!tierByName.has(row.exercise_name)) {
      tierByName.set(row.exercise_name, { movementPatternId: row.movement_pattern_id, tier: row.tier });
    }
  }

  // Slot counts per workout, for the session-position suppressor.
  const slotCountByWorkout = new Map<string, number>();
  for (const e of exerciseRows) {
    slotCountByWorkout.set(e.workout_id, (slotCountByWorkout.get(e.workout_id) ?? 0) + 1);
  }

  const entries: SpotterExerciseEntry[] = [];
  const flatRepeatEntries: FlatRepeatEntry[] = [];
  const categoriesUsed = new Set<string>();

  for (const e of exerciseRows as any[]) {
    const week = weekByWorkoutId.get(e.workout_id);
    if (!week) continue;
    const patternInfo = tierByName.get(e.exercise_name);
    const category = categoryByName.get(e.exercise_name) ?? null;
    if (category) categoriesUsed.add(category);

    const sets = (e.group_workout_exercise_sets ?? []) as any[];
    entries.push({
      exerciseName: e.exercise_name,
      category,
      tier: patternInfo?.tier ?? null,
      movementPatternId: patternInfo?.movementPatternId ?? null,
      setCount: sets.length,
      slotIndex: e.exercise_order,
      slotCountInSession: slotCountByWorkout.get(e.workout_id) ?? 1,
      weekNumber: week,
    });

    // Fingerprint every tracked field the builder supports, not just
    // weight — progressing tempo/ROM/stability is real progression too.
    const fingerprint = sets
      .slice()
      .sort((a, b) => a.set_order - b.set_order)
      .map(
        (s) =>
          `${s.target_reps ?? ""}|${s.target_weight ?? ""}|${s.target_rpe ?? ""}|${s.target_rir ?? ""}|${s.target_tempo ?? ""}|${s.target_time_seconds ?? ""}|${s.target_height ?? ""}|${s.target_distance ?? ""}`
      )
      .join(";");
    flatRepeatEntries.push({
      exerciseName: e.exercise_name,
      weekNumber: week,
      targetsFingerprint: fingerprint,
      // No persisted "progression model attached" flag exists in this
      // app's schema (progression is a one-time generation action, not a
      // stored setting) — the byte-identical-targets check itself is the
      // real signal here.
      hasProgressionModel: false,
    });
  }

  const { data: dismissalRows } = await supabase
    .from("programming_spotter_dismissals")
    .select("check_kind, pattern_key, dismissed_count")
    .eq("program_id", programId);
  const dismissedTwice = new Set(
    (dismissalRows ?? []).filter((d) => d.dismissed_count >= 2).map((d) => `${d.check_kind}::${d.pattern_key}`)
  );
  function isDismissed(kind: SpotterFlag["checkKind"], key: string): boolean {
    return dismissedTwice.has(`${kind}::${key}`);
  }

  const flags: SpotterFlag[] = [];

  for (const f of detectVolumeConcentration(entries)) {
    if (isDismissed("volume_concentration", f.movementPatternId)) continue;
    flags.push({
      checkKind: "volume_concentration",
      patternKey: f.movementPatternId,
      headline: `Week ${f.weekNumber}: ${f.totalSets} sets landed on the same movement pattern, mostly late in the session — a real priority block, or accessory drift worth a second look?`,
    });
  }

  for (const f of detectRedundancy(entries)) {
    if (isDismissed("redundancy", f.movementPatternId)) continue;
    flags.push({
      checkKind: "redundancy",
      patternKey: f.movementPatternId,
      headline: `Week ${f.weekNumber}: ${f.exerciseNames.join(", ")} are stacked back-to-back on the same movement pattern — intentional variety, or would one exercise for the same total sets do the job faster?`,
    });
  }

  for (const f of detectFlatRepeat(flatRepeatEntries)) {
    if (isDismissed("flat_repeat", f.exerciseName)) continue;
    flags.push({
      checkKind: "flat_repeat",
      patternKey: f.exerciseName,
      headline: `${f.exerciseName} has identical targets across ${f.weekCount} straight weeks (${f.weeks.join(", ")}) — worth checking this wasn't meant to progress.`,
    });
  }

  for (const f of detectMissingPatternCoverage(programName, categoriesUsed)) {
    if (isDismissed("missing_pattern", f.category)) continue;
    flags.push({
      checkKind: "missing_pattern",
      patternKey: f.category,
      headline: `"${programName}" reads as a full program, but ${CATEGORY_LABELS[f.category]} never shows up anywhere in it — worth a look?`,
    });
  }

  return flags;
}
