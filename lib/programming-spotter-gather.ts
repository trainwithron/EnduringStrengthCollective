// Programming Spotter — data-orchestration layer (real Supabase queries,
// no unit tests of its own, same convention as lib/coach-briefing-gather.ts
// and lib/dashboard-data.ts — only the pure lib/programming-spotter.ts
// functions it calls are tested).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectVolumeConcentration,
  detectRedundancy,
  detectFlatRepeat,
  isRepRange,
  detectMissingPatternCoverage,
  detectBiomechRedundancy,
  detectTooManyLiftingDays,
  dayLabel,
  firstOfEach,
  pickSamePatternAlternative,
  type ProgramDayEntry,
  type SpotterExerciseEntry,
  type SpotterCategory,
  type SpotterTier,
  type FlatRepeatEntry,
  type BiomechTaggedEntry,
} from "./programming-spotter";
import { shouldPromptStopSuggesting } from "./spotter-feedback";

export interface SpotterFlag {
  // lifting_days (Nov 24): more main lifting days in a week than the client's goal sheet says they can train. Shown only in this panel: it has no cornerstone in
  // lib/spotter-expert-report.ts, so the Tier-1 sync never carries it anywhere else (no push, no bell; Ron: "I don't want to be getting spammed").
  checkKind: "volume_concentration" | "redundancy" | "flat_repeat" | "missing_pattern" | "biomech_redundancy" | "lifting_days";
  patternKey: string;
  headline: string;
  // spotter_feedback_learning_loop_research_sept19.md, Part 2/3: once this
  // coach has denied/edited this exact (checkKind, patternKey) 3+ of the
  // last 5 times it was shown, the panel offers a one-tap "stop showing
  // this" instead of the normal confirm/deny/edit row.
  promptStopSuggesting: boolean;
}

// " (and 2 more days)": the same thing on other days of the program, counted rather than shown again.
const alsoOn = (moreDays: number) => (moreDays > 0 ? ` (and ${moreDays} more day${moreDays === 1 ? "" : "s"})` : "");

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

  // The program's days and its dismissals do not depend on each other: read together (the dismissals are simply unused if there are no days).
  const [{ data: workouts }, { data: dismissalRows }, { data: programRow }] = await Promise.all([
    supabase.from("workouts").select("id, week_number, day_index").eq("program_id", programId),
    supabase.from("programming_spotter_dismissals").select("check_kind, pattern_key, dismissed_count").eq("program_id", programId),
    // whose program it is: the lifting-days check is for a program of ONE client
    supabase.from("programs").select("athlete_id, group_id").eq("id", programId).maybeSingle(),
  ]);
  if (!workouts || workouts.length === 0) return [];

  const weekByWorkoutId = new Map(workouts.map((w) => [w.id, w.week_number as number]));
  const dayByWorkoutId = new Map(workouts.map((w) => [w.id, (w as { day_index?: number | null }).day_index ?? null]));
  const multiWeek = new Set(workouts.map((w) => w.week_number as number)).size > 1;
  const workoutIds = workouts.map((w) => w.id);

  const { data: exerciseRows } = await supabase
    .from("group_workout_exercises")
    .select(
      "id, workout_id, exercise_name, exercise_order, group_workout_exercise_sets ( set_order, target_reps, target_weight, target_rpe, target_rir, target_tempo, target_time_seconds, target_height, target_distance, rep_min, rep_max )"
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
      .select("exercise_name, biomech_tags!inner ( key, joint )")
      .eq("role", "prime_mover")
      .in("exercise_name", exerciseNames),
  ]);

  const primeMoverTagsByName = new Map<string, { keys: string[]; joints: (string | null)[] }>();
  for (const row of (biomechTagRows ?? []) as any[]) {
    const tagKey = row.biomech_tags?.key;
    if (!tagKey) continue;
    const tags = primeMoverTagsByName.get(row.exercise_name) ?? { keys: [], joints: [] };
    tags.keys.push(tagKey);
    tags.joints.push(row.biomech_tags?.joint ?? null);
    primeMoverTagsByName.set(row.exercise_name, tags);
  }

  const categoryByName = new Map((libraryRows ?? []).map((r) => [r.name as string, r.category as SpotterCategory | null]));
  const tierByName = new Map<string, { movementPatternId: string; tier: SpotterTier | null }>();
  // every pattern each exercise is in (the suggested swap must share one with the flagged exercises)
  const patternIdsByName = new Map<string, string[]>();
  for (const row of (tierRows ?? []) as any[]) {
    if (!tierByName.has(row.exercise_name)) {
      tierByName.set(row.exercise_name, { movementPatternId: row.movement_pattern_id, tier: row.tier });
    }
    patternIdsByName.set(row.exercise_name, [...(patternIdsByName.get(row.exercise_name) ?? []), row.movement_pattern_id as string]);
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
      workoutId: e.workout_id,
      dayIndex: dayByWorkoutId.get(e.workout_id) ?? null,
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
      // A rep range (6-8) is the progression itself, so it is never a "flat repeat".
      repsAreRange: sets.some((s) => isRepRange(s.target_reps, s.rep_min, s.rep_max)),
    });

    biomechEntries.push({
      exerciseName: e.exercise_name,
      weekNumber: week,
      workoutId: e.workout_id,
      dayIndex: dayByWorkoutId.get(e.workout_id) ?? null,
      primeMoverTagKeys: primeMoverTagsByName.get(e.exercise_name)?.keys ?? [],
      primeMoverJoints: primeMoverTagsByName.get(e.exercise_name)?.joints ?? [],
      category,
    });
  }

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

  for (const { flag: f, moreDays } of firstOfEach(detectRedundancy(entries), (r) => r.movementPatternId)) {
    if (isDismissed("redundancy", f.movementPatternId)) continue;
    flags.push({
      checkKind: "redundancy",
      patternKey: f.movementPatternId,
      headline: `${dayLabel(f, multiWeek)}${alsoOn(moreDays)}: ${f.exerciseNames.join(", ")} are stacked back-to-back on the same movement pattern — intentional variety, or would one exercise for the same total sets do the job faster?`,
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

  // More lifting days than the client can do (Nov 24): only for a program of one client whose goal sheet says how many days a week they can realistically train.
  const clientId = (programRow as { athlete_id: string | null; group_id: string | null } | null)?.athlete_id ?? null;
  const clientGroupId = (programRow as { athlete_id: string | null; group_id: string | null } | null)?.group_id ?? null;
  if (clientId && clientGroupId) {
    const [{ data: sheet }, { data: client }] = await Promise.all([
      supabase.from("client_goal_sheets").select("days_per_week").eq("athlete_id", clientId).eq("group_id", clientGroupId).maybeSingle(),
      supabase.from("profiles").select("full_name").eq("id", clientId).maybeSingle(),
    ]);
    const dayEntries: ProgramDayEntry[] = [];
    for (const e of exerciseRows as any[]) {
      const week = weekByWorkoutId.get(e.workout_id);
      if (!week) continue;
      dayEntries.push({ workoutId: e.workout_id as string, weekNumber: week, category: categoryByName.get(e.exercise_name) ?? null });
    }
    const f = detectTooManyLiftingDays(dayEntries, (sheet as { days_per_week: number | null } | null)?.days_per_week ?? null);
    // keyed by the number on the sheet, so a changed sheet gets a fresh look even after the coach said no to this one
    const key = f ? `sheet_${f.daysPerWeek}` : "";
    if (f && !isDismissed("lifting_days", key)) {
      const first = ((client as { full_name: string | null } | null)?.full_name ?? "").trim().split(/\s+/)[0] || "This client";
      flags.push({
        checkKind: "lifting_days",
        patternKey: key,
        headline: `Week ${f.weekNumber} has ${f.liftingDays} lifting days, and ${first}'s goal sheet says ${f.daysPerWeek} a week is realistic. Keep it, or trim to ${f.daysPerWeek}?`,
        promptStopSuggesting: false,
      });
    }
  }

  const biomechFlags = firstOfEach(detectBiomechRedundancy(biomechEntries), (f) => f.tagKey).filter(
    ({ flag: f }) => !isDismissed("biomech_redundancy", f.tagKey)
  );
  if (biomechFlags.length > 0) {
    const flaggedTagKeys = [...new Set(biomechFlags.map(({ flag: f }) => f.tagKey))];

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
        .select("exercise_name, tier, movement_pattern_id, movement_patterns!inner ( created_by )")
        .eq("movement_patterns.created_by", coachId)
        .in("exercise_name", allCandidateNames),
    ]);

    const coachOwnCandidateNames = new Set((candidateLibraryRows ?? []).map((r) => r.name as string));
    // one candidate per (exercise, pattern) row, so the tier is the one it has in that pattern
    const candidateRows = ((candidateTierRows ?? []) as any[]).map((row) => ({ name: row.exercise_name as string, tier: (row.tier ?? null) as SpotterTier | null, patternIds: [row.movement_pattern_id as string] }));

    for (const { flag: f, moreDays } of biomechFlags) {
      const withTag = candidateNamesByTag.get(f.tagKey) ?? new Set<string>();
      const alternative = pickSamePatternAlternative(
        f.exerciseNames,
        patternIdsByName,
        candidateRows.filter((c) => withTag.has(c.name) && coachOwnCandidateNames.has(c.name))
      );
      const tagLabel = labelByTagKey.get(f.tagKey) ?? f.tagKey.replace(/_/g, " ");
      const exerciseList = f.exerciseNames.join(", ");
      const where = `${dayLabel(f, multiWeek)}${alsoOn(moreDays)}`;
      const headline = alternative
        ? `${where}: ${exerciseList} all train ${tagLabel} — intentional specialization, or would ${alternative} for more total load cover the same ground?`
        : `${where}: ${exerciseList} all train ${tagLabel} — worth consolidating, or intentional?`;
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
