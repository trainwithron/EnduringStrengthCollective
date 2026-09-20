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
  detectBiomechRedundancy,
  type SpotterExerciseEntry,
  type SpotterCategory,
  type SpotterTier,
  type FlatRepeatEntry,
  type BiomechTaggedEntry,
} from "./programming-spotter";
import { shouldPromptStopSuggesting } from "./spotter-feedback";

export interface SpotterFlag {
  checkKind: "volume_concentration" | "redundancy" | "flat_repeat" | "missing_pattern" | "biomech_redundancy";
  patternKey: string;
  headline: string;
  // spotter_feedback_learning_loop_research_sept19.md, Part 2/3: once this
  // coach has denied/edited this exact (checkKind, patternKey) 3+ of the
  // last 5 times it was shown, the panel offers a one-tap "stop showing
  // this" instead of the normal confirm/deny/edit row.
  promptStopSuggesting: boolean;
}

// A > B > C > untiered, for the biomech-redundancy check's alternative-
// exercise selection (biomechanical_redundancy_consolidation_spotter_
// idea.md, Q2) — same ordering the ladder-picker's own tier field
// already carries meaning for, just reused as a plain sort weight here
// rather than a ranked ladder.
const TIER_RANK: Record<string, number> = { A: 3, B: 2, C: 1 };

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

  const [{ data: libraryRows }, { data: tierRows }, { data: biomechTagRows }] = await Promise.all([
    supabase.from("exercise_library").select("name, category").eq("created_by", coachId).in("name", exerciseNames),
    supabase
      .from("movement_pattern_exercises")
      .select("exercise_name, movement_pattern_id, tier, movement_patterns!inner ( created_by )")
      .eq("movement_patterns.created_by", coachId)
      .in("exercise_name", exerciseNames),
    // exercise_biomech_tags is a shared/collaborative tagging layer
    // (any coach can tag any exercise name, see 0173_biomech_tags.sql's
    // own RLS comment) — deliberately NOT coach-scoped here, unlike
    // libraryRows/tierRows, since a tag someone else applied to a
    // shared exercise name is still real biomechanical fact.
    supabase
      .from("exercise_biomech_tags")
      .select("exercise_name, biomech_tags!inner ( key )")
      .eq("role", "prime_mover")
      .in("exercise_name", exerciseNames),
  ]);

  const primeMoverTagsByName = new Map<string, string[]>();
  for (const row of (biomechTagRows ?? []) as any[]) {
    const tagKey = row.biomech_tags?.key;
    if (!tagKey) continue;
    const list = primeMoverTagsByName.get(row.exercise_name) ?? [];
    list.push(tagKey);
    primeMoverTagsByName.set(row.exercise_name, list);
  }

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
  const biomechEntries: BiomechTaggedEntry[] = [];
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

    biomechEntries.push({
      exerciseName: e.exercise_name,
      weekNumber: week,
      primeMoverTagKeys: primeMoverTagsByName.get(e.exercise_name) ?? [],
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
      promptStopSuggesting: false,
    });
  }

  for (const f of detectRedundancy(entries)) {
    if (isDismissed("redundancy", f.movementPatternId)) continue;
    flags.push({
      checkKind: "redundancy",
      patternKey: f.movementPatternId,
      headline: `Week ${f.weekNumber}: ${f.exerciseNames.join(", ")} are stacked back-to-back on the same movement pattern — intentional variety, or would one exercise for the same total sets do the job faster?`,
      promptStopSuggesting: false,
    });
  }

  for (const f of detectFlatRepeat(flatRepeatEntries)) {
    if (isDismissed("flat_repeat", f.exerciseName)) continue;
    flags.push({
      checkKind: "flat_repeat",
      patternKey: f.exerciseName,
      headline: `${f.exerciseName} has identical targets across ${f.weekCount} straight weeks (${f.weeks.join(", ")}) — worth checking this wasn't meant to progress.`,
      promptStopSuggesting: false,
    });
  }

  for (const f of detectMissingPatternCoverage(programName, categoriesUsed)) {
    if (isDismissed("missing_pattern", f.category)) continue;
    flags.push({
      checkKind: "missing_pattern",
      patternKey: f.category,
      headline: `"${programName}" reads as a full program, but ${CATEGORY_LABELS[f.category]} never shows up anywhere in it — worth a look?`,
      promptStopSuggesting: false,
    });
  }

  const biomechFlags = detectBiomechRedundancy(biomechEntries).filter(
    (f) => !isDismissed("biomech_redundancy", f.tagKey)
  );
  if (biomechFlags.length > 0) {
    const flaggedTagKeys = [...new Set(biomechFlags.map((f) => f.tagKey))];

    // Selection lookup (Q2): among ANY exercise tagged prime_mover with a
    // flagged tag key, narrow to the coach's own exercise_library, then
    // rank by movement_pattern_exercises.tier (A > B > C > untiered),
    // alphabetical tie-break. Deliberately two more small queries here
    // rather than widening the coach-scoped libraryRows/tierRows fetch
    // above — those are scoped to exerciseNames already IN the program,
    // and a real alternative is by definition usually NOT already in it.
    const { data: candidateTagRows } = await supabase
      .from("exercise_biomech_tags")
      .select("exercise_name, biomech_tags!inner ( key, label )")
      .eq("role", "prime_mover")
      .in("biomech_tags.key", flaggedTagKeys);

    const candidateNamesByTag = new Map<string, Set<string>>();
    const labelByTagKey = new Map<string, string>();
    for (const row of (candidateTagRows ?? []) as any[]) {
      const tagKey = row.biomech_tags?.key;
      const label = row.biomech_tags?.label;
      if (!tagKey) continue;
      if (label) labelByTagKey.set(tagKey, label);
      const names = candidateNamesByTag.get(tagKey) ?? new Set<string>();
      names.add(row.exercise_name);
      candidateNamesByTag.set(tagKey, names);
    }

    const allCandidateNames = [...new Set([...candidateNamesByTag.values()].flatMap((s) => [...s]))];
    const [{ data: candidateLibraryRows }, { data: candidateTierRows }] = await Promise.all([
      supabase.from("exercise_library").select("name").eq("created_by", coachId).in("name", allCandidateNames),
      supabase
        .from("movement_pattern_exercises")
        .select("exercise_name, tier, movement_patterns!inner ( created_by )")
        .eq("movement_patterns.created_by", coachId)
        .in("exercise_name", allCandidateNames),
    ]);

    const coachOwnCandidateNames = new Set((candidateLibraryRows ?? []).map((r) => r.name as string));
    const tierByCandidateName = new Map<string, SpotterTier | null>();
    for (const row of (candidateTierRows ?? []) as any[]) {
      if (!tierByCandidateName.has(row.exercise_name)) tierByCandidateName.set(row.exercise_name, row.tier);
    }

    function pickBestAlternative(tagKey: string, excludeNames: string[]): string | null {
      const names = [...(candidateNamesByTag.get(tagKey) ?? [])].filter(
        (n) => coachOwnCandidateNames.has(n) && !excludeNames.includes(n)
      );
      if (names.length === 0) return null;
      names.sort((a, b) => {
        const rankA = TIER_RANK[tierByCandidateName.get(a) ?? ""] ?? 0;
        const rankB = TIER_RANK[tierByCandidateName.get(b) ?? ""] ?? 0;
        if (rankA !== rankB) return rankB - rankA;
        return a.localeCompare(b);
      });
      return names[0];
    }

    for (const f of biomechFlags) {
      const alternative = pickBestAlternative(f.tagKey, f.exerciseNames);
      const tagLabel = labelByTagKey.get(f.tagKey) ?? f.tagKey.replace(/_/g, " ");
      const exerciseList = f.exerciseNames.join(", ");
      const headline = alternative
        ? `Week ${f.weekNumber}: ${exerciseList} all train ${tagLabel} — intentional specialization, or would ${alternative} for more total load cover the same ground?`
        : `Week ${f.weekNumber}: ${exerciseList} all train ${tagLabel} — worth consolidating, or intentional?`;
      flags.push({ checkKind: "biomech_redundancy", patternKey: f.tagKey, headline, promptStopSuggesting: false });
    }
  }

  // spotter_feedback_learning_loop_research_sept19.md, Part 2/3: one
  // batched fetch of this coach's own recent feedback events for every
  // dismissal_key still on screen, then a plain minimum-sample majority
  // check per key — no Wilson bound, this isn't a comparative ranking.
  if (flags.length > 0) {
    const dismissalKeys = [...new Set(flags.map((f) => `${f.checkKind}::${f.patternKey}`))];
    const { data: feedbackRows } = await supabase
      .from("spotter_recommendation_feedback")
      .select("dismissal_key, action, created_at")
      .eq("coach_id", coachId)
      .eq("spotter_kind", "programming")
      .in("dismissal_key", dismissalKeys)
      .order("created_at", { ascending: false })
      .limit(500);

    const eventsByKey = new Map<string, { action: "confirmed" | "denied" | "edited" }[]>();
    for (const row of feedbackRows ?? []) {
      const list = eventsByKey.get(row.dismissal_key) ?? [];
      list.push({ action: row.action as "confirmed" | "denied" | "edited" });
      eventsByKey.set(row.dismissal_key, list);
    }

    for (const flag of flags) {
      const key = `${flag.checkKind}::${flag.patternKey}`;
      flag.promptStopSuggesting = shouldPromptStopSuggesting(eventsByKey.get(key) ?? []);
    }
  }

  return flags;
}
