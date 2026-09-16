// Training-block-aware macro suggestion — data-orchestration layer (real
// Supabase queries, no unit tests of its own, same convention as
// lib/programming-spotter-gather.ts — only the pure
// lib/nutrition-block-adjustment.ts functions it calls are tested).
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveEventWindow } from "./event-window";
import { computeScheduledDates } from "./program-schedule";
import { parseNumericReps } from "./program-card-visuals";
import {
  taperAdjustedMacroSuggestion,
  volumeRelativeMacroSuggestion,
  type MacroSuggestion,
} from "./nutrition-block-adjustment";

// The same value the already-shipped Endurance Race Taper uses
// (app/groups/[groupId]/athletes/[athleteId]/page.tsx's
// ENDURANCE_TAPER_WEEKS) — reused, not a second independently-chosen
// number for the same concept.
const TAPER_WEEKS = 2;
const TRAILING_WEEKS = 4;
const LBS_TO_KG = 0.453592;

export async function gatherMacroSuggestion(
  supabase: SupabaseClient,
  params: { athleteId: string; groupId: string; date: string }
): Promise<MacroSuggestion | null> {
  const { athleteId, groupId, date } = params;
  const today = new Date(`${date}T00:00:00`);

  // Baseline to hold (Rule 1) or adjust from (Rule 2): the most recent
  // saved target on or before this date — "the pre-taper trailing value"
  // in the spec's own words, resolved simply as the last real number the
  // coach actually set, not a computed average.
  const { data: recentMacro } = await supabase
    .from("daily_macros")
    .select("calories")
    .eq("athlete_id", athleteId)
    .lte("log_date", date)
    .order("log_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const baseCalories = recentMacro?.calories ?? null;

  // Rule 1 first, and it always wins when it fires: a taper week's real
  // drop in planned volume would itself trip Rule 2's "lighter week"
  // branch — which is exactly the naive calorie-cut mistake Rule 1
  // exists to prevent. Same goal query shape as the client-profile page's
  // own event-window derivation.
  const { data: goalRow } = await supabase
    .from("client_goals")
    .select("status, target_date, event_type, event_expected_duration_minutes, event_priority, weight_class_flag")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .eq("status", "confirmed")
    .not("target_date", "is", null)
    .not("event_type", "is", null)
    .order("confirmed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (goalRow) {
    const eventWindow = deriveEventWindow({
      status: goalRow.status,
      targetDate: goalRow.target_date,
      eventType: goalRow.event_type,
      eventExpectedDurationMinutes: goalRow.event_expected_duration_minutes,
      eventPriority: goalRow.event_priority as "A" | "B" | "C" | null,
      weightClassFlag: goalRow.weight_class_flag,
    });
    if (eventWindow) {
      const { data: weightRow } = await supabase
        .from("body_weight_logs")
        .select("weight")
        .eq("athlete_id", athleteId)
        .order("logged_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const bodyWeightKg = weightRow?.weight ? weightRow.weight * LBS_TO_KG : null;

      const taper = taperAdjustedMacroSuggestion({
        baseCalories,
        eventWindow,
        today,
        taperWeeks: TAPER_WEEKS,
        bodyWeightKg,
      });
      if (taper) return taper;
    }
  }

  // Rule 2 — this week's planned volume-load vs. the trailing 4-week
  // average on the same program. Same target_weight x target_reps
  // signal program-card-data.ts already computes for the program-card
  // sparkline (its map isn't exported, so the query is repeated here,
  // scoped to one program). Shared group program only, matching the
  // day page's own program resolution.
  const { data: program } = await supabase
    .from("programs")
    .select("id, start_date, training_days")
    .eq("group_id", groupId)
    .eq("is_active", true)
    .maybeSingle();
  if (!program?.start_date || !program.training_days?.length) return null;

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, week_number, scheduled_date")
    .eq("program_id", program.id)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });
  if (!workouts || workouts.length === 0) return null;

  const scheduledDateByDayId = computeScheduledDates(
    program.start_date,
    program.training_days,
    workouts.map((w) => ({ id: w.id, scheduledDate: w.scheduled_date }))
  );
  let thisWeekNumber: number | null = null;
  for (const w of workouts) {
    const d = scheduledDateByDayId.get(w.id);
    if (d && d.toISOString().slice(0, 10) === date) {
      thisWeekNumber = w.week_number as number;
      break;
    }
  }
  // Week 1 has no trailing history to compare against — nothing to say.
  if (thisWeekNumber == null || thisWeekNumber <= 1) return null;

  const weekByWorkoutId = new Map(workouts.map((w) => [w.id as string, w.week_number as number]));
  const { data: exercises } = await supabase
    .from("group_workout_exercises")
    .select("id, workout_id")
    .in(
      "workout_id",
      workouts.map((w) => w.id)
    );
  if (!exercises || exercises.length === 0) return null;
  const workoutIdByExerciseId = new Map(exercises.map((e) => [e.id as string, e.workout_id as string]));

  const { data: sets } = await supabase
    .from("group_workout_exercise_sets")
    .select("group_workout_exercise_id, target_weight, target_reps")
    .in(
      "group_workout_exercise_id",
      exercises.map((e) => e.id)
    );

  const volumeByWeek = new Map<number, number>();
  for (const s of sets ?? []) {
    const workoutId = workoutIdByExerciseId.get(s.group_workout_exercise_id);
    const week = workoutId ? weekByWorkoutId.get(workoutId) : undefined;
    const reps = parseNumericReps(s.target_reps);
    if (!week || !reps || !s.target_weight) continue;
    volumeByWeek.set(week, (volumeByWeek.get(week) ?? 0) + s.target_weight * reps);
  }

  const thisWeekVolume = volumeByWeek.get(thisWeekNumber) ?? 0;
  const trailing: number[] = [];
  for (let n = 1; n <= TRAILING_WEEKS; n++) {
    const week = thisWeekNumber - n;
    if (week < 1) break;
    const v = volumeByWeek.get(week);
    if (v && v > 0) trailing.push(v);
  }
  if (trailing.length === 0) return null;
  const trailingAvgVolume = trailing.reduce((a, b) => a + b, 0) / trailing.length;

  return volumeRelativeMacroSuggestion({ baseCalories, thisWeekVolume, trailingAvgVolume });
}
