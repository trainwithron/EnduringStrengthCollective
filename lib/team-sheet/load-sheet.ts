// Fills the team sheet model from the database, as the signed-in coach (row security decides what they may read). Day sheet: the workouts the group has scheduled on that date. Week sheet: the same for the
// seven days of the week that holds the date; only days that have a workout appear. The racks are made from the roster at this moment; the sheet code keeps who was on which rack.
import { pageAll } from "@/lib/page-all";
import { readRowsByIds } from "@/lib/read-by-ids";
import {
  MAX_ATHLETES,
  MAX_EXERCISES_TOTAL,
  MAX_RACKS,
  dayLabel,
  describePrescription,
  isDateKey,
  makeRacks,
  weekDates,
  type SheetDay,
  type SheetExercise,
  type SheetModel,
} from "@/lib/team-sheet/sheet-model";
import type { SheetUnit } from "@/lib/team-sheet/cell-parser";

export type LoadSheetResult = { ok: true; model: SheetModel } | { ok: false; status: number; error: string };

export interface LoadSheetInput {
  groupId: string;
  mode: "day" | "week";
  date: string;
  perRack: number;
  unit: SheetUnit;
}

type WorkoutRow = { id: string; title: string | null; scheduled_date: string; day_index: number | null };
type ExerciseRow = {
  id: string;
  workout_id: string;
  exercise_name: string;
  exercise_order: number | null;
  prescribed_sets: number | null;
  prescribed_reps: string | null;
  prescribed_load_note: string | null;
  group_workout_exercise_sets: { set_order: number | null; target_reps: string | null; target_time_seconds: number | null; target_distance: number | null }[] | null;
};

export async function loadSheetModel(supabase: any, input: LoadSheetInput): Promise<LoadSheetResult> {
  if (!isDateKey(input.date)) return { ok: false, status: 400, error: "Choose a date." };
  const { data: group, error: groupError } = await supabase.from("groups").select("id, name, group_kind").eq("id", input.groupId).maybeSingle();
  if (groupError) return { ok: false, status: 502, error: "Couldn't read the group. Try again." };
  if (!group) return { ok: false, status: 404, error: "That group wasn't found." };
  if (group.group_kind === "one_on_one") return { ok: false, status: 409, error: "A team sheet is for a team or a class, not a one-on-one client." };

  const dates = input.mode === "week" ? weekDates(input.date) : [input.date];
  const { data: workouts, error: workoutError } = await supabase
    .from("workouts")
    .select("id, title, scheduled_date, day_index")
    .eq("group_id", input.groupId)
    .in("scheduled_date", dates)
    .order("scheduled_date", { ascending: true })
    .order("day_index", { ascending: true });
  if (workoutError) return { ok: false, status: 502, error: "Couldn't read the workouts. Try again." };
  const workoutRows = (workouts ?? []) as WorkoutRow[];
  if (workoutRows.length === 0) {
    return { ok: false, status: 404, error: input.mode === "week" ? "No workouts are scheduled that week. Schedule the workouts on the calendar first." : `No workout is scheduled for ${dayLabel(input.date)}. Schedule it on the calendar first.` };
  }

  const exerciseRead = await readRowsByIds(workoutRows.map((w) => w.id), (ids: string[]) => (from: number, to: number) =>
    supabase
      .from("group_workout_exercises")
      .select("id, workout_id, exercise_name, exercise_order, prescribed_sets, prescribed_reps, prescribed_load_note, group_workout_exercise_sets ( set_order, target_reps, target_time_seconds, target_distance )")
      .in("workout_id", ids)
      .order("exercise_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (exerciseRead.error) return { ok: false, status: 502, error: "Couldn't read the exercises. Try again." };
  const byWorkout = new Map<string, ExerciseRow[]>();
  for (const e of (exerciseRead.data ?? []) as ExerciseRow[]) byWorkout.set(e.workout_id, [...(byWorkout.get(e.workout_id) ?? []), e]);

  const days: SheetDay[] = [];
  for (const date of dates) {
    const todays = workoutRows.filter((w) => w.scheduled_date === date);
    if (todays.length === 0) continue;
    const exercises: SheetExercise[] = [];
    for (const w of todays) {
      for (const e of byWorkout.get(w.id) ?? []) {
        const sets = [...(e.group_workout_exercise_sets ?? [])].sort((a, b) => (a.set_order ?? 0) - (b.set_order ?? 0));
        const p = describePrescription({ prescribed_sets: e.prescribed_sets, prescribed_reps: e.prescribed_reps, sets, load_note: e.prescribed_load_note });
        const unread = sets.some((s) => (s.target_time_seconds ?? 0) > 0 || (s.target_distance ?? 0) > 0);
        exercises.push({ id: e.id, name: e.exercise_name, prescription: p.text, sets: p.sets, reps: p.reps, unread });
      }
    }
    days.push({ date, label: dayLabel(date), title: todays.map((w) => (w.title ?? "").trim()).filter(Boolean).join(" / ").slice(0, 40), exercises });
  }
  const total = days.reduce((s, d) => s + d.exercises.length, 0);
  if (total === 0) return { ok: false, status: 404, error: "That workout has no exercises yet." };
  if (total > MAX_EXERCISES_TOTAL) return { ok: false, status: 422, error: `That is ${total} exercises, more than one sheet can carry (${MAX_EXERCISES_TOTAL}). Choose a Day sheet, or a shorter week.` };

  const roster = await pageAll((from: number, to: number) => supabase.from("group_memberships").select("profile_id, profiles ( full_name )").eq("group_id", input.groupId).eq("role", "athlete").order("profile_id").range(from, to), { maxPages: 10 });
  if (roster.failed) return { ok: false, status: 502, error: "Couldn't read the roster. Try again." };
  if (roster.truncated || roster.rows.length > MAX_ATHLETES) return { ok: false, status: 422, error: `That roster is larger than one sheet run can carry (${MAX_ATHLETES} athletes).` };
  if (roster.rows.length === 0) return { ok: false, status: 404, error: "There are no athletes in this group yet." };
  const athletes = roster.rows.map((r: any) => ({ id: r.profile_id as string, fullName: ((Array.isArray(r.profiles) ? r.profiles[0] : r.profiles)?.full_name as string | null) ?? "" }));
  const racks = makeRacks(athletes, input.perRack);
  if (racks.length > MAX_RACKS) return { ok: false, status: 422, error: "That is more racks than one run can carry. Put more athletes on each rack." };

  return { ok: true, model: { groupId: input.groupId, groupName: String(group.name ?? "Team"), mode: input.mode, unit: input.unit, days, racks } };
}
