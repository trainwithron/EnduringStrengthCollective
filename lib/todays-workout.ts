import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScheduledDates, isLocked } from "./program-schedule";

export type TodaysWorkoutResult =
  | { status: "ready"; workoutId: string }
  | { status: "locked"; unlocksOn: Date }
  | { status: "done" }
  | { status: "no-program" };

// "Today's workout": the active program's first workout (in week/day
// order) this athlete hasn't logged a completion for yet. If the program
// has a schedule set (start_date/training_days), that workout is only
// "ready" once its computed date has actually arrived — otherwise it's
// still the athlete's next workout, just not due today.
//
// A coach-assigned workout_assignments row for today always wins over
// that auto-sequenced pick — it's an explicit override, so it's never
// locked, regardless of what the program schedule says.
export async function getTodaysWorkoutId(
  supabase: SupabaseClient,
  { groupId, athleteId }: { groupId: string; athleteId: string }
): Promise<TodaysWorkoutResult> {
  const todayKey = new Date().toISOString().slice(0, 10);
  const { data: override } = await supabase
    .from("workout_assignments")
    .select("workout_id")
    .eq("athlete_id", athleteId)
    .eq("scheduled_date", todayKey)
    .maybeSingle();

  if (override?.workout_id) {
    return { status: "ready", workoutId: override.workout_id };
  }

  // A personal program assigned to this specific athlete always wins over
  // the group's shared one — same precedence as the workout_assignments
  // override above, one level up. Two separate queries (not one filtered
  // by `athlete_id = X or athlete_id is null`) since both could otherwise
  // be simultaneously "active" — one shared, one personal — and
  // .maybeSingle() would error on more than one row.
  const { data: personalProgram } = await supabase
    .from("programs")
    .select("id, start_date, training_days, visibility_window")
    .eq("group_id", groupId)
    .eq("athlete_id", athleteId)
    .eq("is_active", true)
    .maybeSingle();

  const { data: sharedProgram } = personalProgram
    ? { data: null }
    : await supabase
        .from("programs")
        .select("id, start_date, training_days, visibility_window")
        .eq("group_id", groupId)
        .is("athlete_id", null)
        .eq("is_active", true)
        .maybeSingle();

  const program = personalProgram ?? sharedProgram;

  if (!program) return { status: "no-program" };

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id")
    .eq("program_id", program.id)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  if (!workouts || workouts.length === 0) return { status: "no-program" };

  const { data: logs } = await supabase
    .from("workout_logs")
    .select("workout_id")
    .eq("athlete_id", athleteId)
    .in(
      "workout_id",
      workouts.map((w) => w.id)
    );

  const loggedIds = new Set((logs ?? []).map((l) => l.workout_id));
  const next = workouts.find((w) => !loggedIds.has(w.id));

  if (!next) return { status: "done" };

  if (program.start_date && program.training_days && program.training_days.length > 0) {
    const scheduledDateByDayId = computeScheduledDates(
      program.start_date,
      program.training_days,
      workouts
    );
    const scheduledDate = scheduledDateByDayId.get(next.id);
    if (isLocked(scheduledDate, new Date(), program.visibility_window)) {
      return { status: "locked", unlocksOn: scheduledDate! };
    }
  }

  return { status: "ready", workoutId: next.id };
}
