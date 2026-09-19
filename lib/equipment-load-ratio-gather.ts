// Data-orchestration layer for equipment-variant load-ratio learning
// (equipment_variant_load_ratio_and_smart_swap_scoping_sept19.md) — real
// Supabase queries, no unit tests of its own, same convention as
// lib/programming-spotter-gather.ts (only the pure lib/equipment-load-
// ratio.ts functions it calls are tested).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeVariantRatioSamples,
  medianRatio,
  MIN_SAMPLE_COUNT_FOR_RATIO,
  type DatedWeight,
} from "./equipment-load-ratio";

// Runs after a workout session completes — "this swap's own logged sets
// become the seed data for the next occurrence" (the task's own words).
// Scans this ONE athlete's entire logged-weight history (not just this
// session — a ratio only firms up once real paired data exists across
// more than one occasion), finds every pair of exercise names that
// share a movement_pattern_id but carry different equipment_type
// values, and upserts a learned ratio wherever enough real paired
// same-day evidence exists. Cheap in practice: an individual athlete's
// own distinct exercise-name vocabulary is small (dozens at most), so
// the pairwise scan below is bounded.
export async function refreshEquipmentLoadRatios(
  supabase: SupabaseClient,
  params: { athleteId: string; coachId: string }
): Promise<void> {
  const { athleteId, coachId } = params;

  const { data: sessionRows } = await supabase
    .from("athlete_sessions")
    .select("id, completed_at")
    .eq("athlete_id", athleteId)
    .not("completed_at", "is", null);
  if (!sessionRows || sessionRows.length === 0) return;

  const sessionDateById = new Map(
    sessionRows.map((s) => [s.id as string, (s.completed_at as string).slice(0, 10)])
  );
  const sessionIds = sessionRows.map((s) => s.id as string);

  const { data: exerciseRows } = await supabase
    .from("session_exercises")
    .select("id, session_id, exercise_name, movement_pattern_id")
    .in("session_id", sessionIds)
    .not("movement_pattern_id", "is", null);
  if (!exerciseRows || exerciseRows.length === 0) return;

  const exerciseIds = exerciseRows.map((e) => e.id as string);
  const { data: setRows } = await supabase
    .from("set_logs")
    .select("session_exercise_id, weight")
    .in("session_exercise_id", exerciseIds)
    .not("weight", "is", null);
  if (!setRows || setRows.length === 0) return;

  const exerciseById = new Map(exerciseRows.map((e) => [e.id as string, e]));

  // (movementPatternId -> exerciseName -> that exercise's own dated
  // logged weights, one entry per set — collapseToDailyMax handles
  // reducing same-day multiples down to that day's top weight).
  const historyByPatternAndName = new Map<string, Map<string, DatedWeight[]>>();
  const namesByPattern = new Map<string, Set<string>>();

  for (const row of setRows) {
    const exercise = exerciseById.get(row.session_exercise_id as string);
    if (!exercise) continue;
    const sessionDate = sessionDateById.get(exercise.session_id as string);
    if (!sessionDate) continue;

    const patternId = exercise.movement_pattern_id as string;
    const name = exercise.exercise_name as string;

    const byName = historyByPatternAndName.get(patternId) ?? new Map<string, DatedWeight[]>();
    const history = byName.get(name) ?? [];
    history.push({ sessionDate, weight: row.weight as number });
    byName.set(name, history);
    historyByPatternAndName.set(patternId, byName);

    const names = namesByPattern.get(patternId) ?? new Set<string>();
    names.add(name);
    namesByPattern.set(patternId, names);
  }

  const allNames = [...new Set(exerciseRows.map((e) => e.exercise_name as string))];
  const { data: libraryRows } = await supabase
    .from("exercise_library")
    .select("name, equipment_type")
    .eq("created_by", coachId)
    .in("name", allNames);
  const equipmentByName = new Map((libraryRows ?? []).map((r) => [r.name as string, r.equipment_type as string | null]));

  const upserts: { athlete_id: string; exercise_name_a: string; exercise_name_b: string; ratio: number; sample_count: number }[] = [];

  for (const [patternId, names] of namesByPattern.entries()) {
    const patternHistory = historyByPatternAndName.get(patternId);
    if (!patternHistory) continue;
    const nameList = [...names];

    for (let i = 0; i < nameList.length; i++) {
      for (let j = i + 1; j < nameList.length; j++) {
        const [nameA, nameB] = [nameList[i], nameList[j]].sort();
        const equipmentA = equipmentByName.get(nameA);
        const equipmentB = equipmentByName.get(nameB);
        // Both must have a real, DIFFERENT classified equipment type —
        // two names with no equipment_type set yet (or the same one)
        // aren't a real "variant pair" by this feature's own definition.
        if (!equipmentA || !equipmentB || equipmentA === equipmentB) continue;

        const realHistoryA = patternHistory.get(nameA) ?? [];
        const realHistoryB = patternHistory.get(nameB) ?? [];

        const ratios = computeVariantRatioSamples(realHistoryA, realHistoryB);
        if (ratios.length < MIN_SAMPLE_COUNT_FOR_RATIO) continue;

        const ratio = medianRatio(ratios);
        if (ratio == null) continue;

        upserts.push({
          athlete_id: athleteId,
          exercise_name_a: nameA,
          exercise_name_b: nameB,
          ratio,
          sample_count: ratios.length,
        });
      }
    }
  }

  if (upserts.length === 0) return;

  await supabase
    .from("athlete_equipment_load_ratios")
    .upsert(
      upserts.map((u) => ({ ...u, updated_at: new Date().toISOString() })),
      { onConflict: "athlete_id,exercise_name_a,exercise_name_b" }
    );
}

// Suggestion-time lookup — a single indexed query for one specific pair,
// called right when a swap happens (not the refresh above, which is a
// broader recompute). Returns null when nothing's been learned yet for
// this exact pair (the honest, expected default for most swaps early on).
export async function findLoadRatio(
  supabase: SupabaseClient,
  params: { athleteId: string; exerciseNameOne: string; exerciseNameTwo: string }
): Promise<{ exerciseNameA: string; exerciseNameB: string; ratio: number } | null> {
  const [nameA, nameB] = [params.exerciseNameOne, params.exerciseNameTwo].sort();
  const { data } = await supabase
    .from("athlete_equipment_load_ratios")
    .select("exercise_name_a, exercise_name_b, ratio")
    .eq("athlete_id", params.athleteId)
    .eq("exercise_name_a", nameA)
    .eq("exercise_name_b", nameB)
    .maybeSingle();
  if (!data) return null;
  return { exerciseNameA: data.exercise_name_a, exerciseNameB: data.exercise_name_b, ratio: data.ratio };
}
