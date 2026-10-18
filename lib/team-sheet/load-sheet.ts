// Fills the team sheet model from the database, as the signed-in coach (row security decides what they may read).
//
// Which workouts, and on which days, is the COACH's choice, because a program does not always say. A program with a start date and training days puts workouts on dates, but a team often runs a program as a sequence
// (Week 3, Day 2) with no dates at all. So:
//   Day sheet:   one workout of the group's active program, on a date the coach picks.
//   Week sheet:  one week of the program (all its workouts, in order), starting on a date the coach picks, placed on the training days the coach picks (Day 1 on the first chosen day, and so on).
// Only the group's shared, active programs count: a program or exercise written for one athlete is not the team's. The racks are made from the roster at this moment; the sheet code keeps who was on which rack.
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

export type LoadSheetInput = {
  groupId: string;
  perRack: number;
  unit: SheetUnit;
} & (
  | { mode: "day"; workoutId: string; date: string }
  // days: weekdays, 0 = Sunday .. 6 = Saturday; start: any date, the week is the Monday-to-Sunday week that holds it
  | { mode: "week"; programId: string; week: number; start: string; days: number[] }
);

// The columns each read asks for. Written once so a test can check every name against the database's own table definitions (a column that does not exist makes the whole read fail, and a mocked test cannot see that).
export const SHEET_READS = {
  groups: "id, name, group_kind",
  programs: "id, name, created_at, start_date, training_days",
  workouts: "id, program_id, title, week_number, day_index",
  exercises: "id, workout_id, exercise_name, display_name, exercise_order, athlete_id, tracked_fields, group_workout_exercise_sets ( set_order, target_reps, target_time_seconds, target_distance )",
  roster: "profile_id, profiles ( full_name )",
} as const;

type ProgramRow = { id: string; name: string; created_at: string; start_date: string | null; training_days: number[] | null };
type WorkoutRow = { id: string; program_id: string; title: string | null; week_number: number | null; day_index: number | null };
type ExerciseRow = {
  id: string;
  workout_id: string;
  exercise_name: string;
  display_name: string | null;
  exercise_order: number | null;
  athlete_id: string | null;
  tracked_fields: string[] | null;
  group_workout_exercise_sets: { set_order: number | null; target_reps: string | null; target_time_seconds: number | null; target_distance: number | null }[] | null;
};

const byOrder = (a: WorkoutRow, b: WorkoutRow) => (a.week_number ?? 0) - (b.week_number ?? 0) || (a.day_index ?? 0) - (b.day_index ?? 0) || a.id.localeCompare(b.id);

async function readPrograms(supabase: any, groupId: string): Promise<{ programs: ProgramRow[]; workouts: WorkoutRow[] } | { error: string }> {
  const { data: programs, error } = await supabase.from("programs").select(SHEET_READS.programs).eq("group_id", groupId).eq("is_active", true).is("athlete_id", null).order("created_at", { ascending: true });
  if (error) return { error: "Couldn't read the programs. Try again." };
  const programRows = (programs ?? []) as ProgramRow[];
  const read = await readRowsByIds(programRows.map((p) => p.id), (ids: string[]) => (from: number, to: number) =>
    supabase.from("workouts").select(SHEET_READS.workouts).in("program_id", ids).order("week_number", { ascending: true }).order("day_index", { ascending: true }).order("id", { ascending: true }).range(from, to)
  );
  if (read.error || read.truncated) return { error: "Couldn't read the workouts. Try again." };
  return { programs: programRows, workouts: (read.data as WorkoutRow[]).sort(byOrder) };
}

/** What the Team sheet page offers: the group's active shared programs, their weeks and workouts, and the training days each already has. */
export interface SheetOptions {
  programs: { id: string; name: string; trainingDays: number[]; weeks: { week: number; workouts: { id: string; day: number; title: string }[] }[] }[];
}
export async function loadSheetOptions(supabase: any, groupId: string): Promise<{ ok: true; options: SheetOptions } | { ok: false; error: string }> {
  const read = await readPrograms(supabase, groupId);
  if ("error" in read) return { ok: false, error: read.error };
  const options: SheetOptions = { programs: [] };
  for (const p of read.programs) {
    const mine = read.workouts.filter((w) => w.program_id === p.id);
    if (mine.length === 0) continue;
    const weeks = new Map<number, { id: string; day: number; title: string }[]>();
    for (const w of mine) {
      const wk = w.week_number ?? 1;
      weeks.set(wk, [...(weeks.get(wk) ?? []), { id: w.id, day: w.day_index ?? 0, title: (w.title ?? "").trim() || `Day ${w.day_index ?? ""}`.trim() }]);
    }
    options.programs.push({
      id: p.id,
      name: p.name,
      trainingDays: Array.isArray(p.training_days) ? p.training_days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [],
      weeks: Array.from(weeks.entries()).sort((a, b) => a[0] - b[0]).map(([week, workouts]) => ({ week, workouts })),
    });
  }
  return { ok: true, options };
}

export async function loadSheetModel(supabase: any, input: LoadSheetInput): Promise<LoadSheetResult> {
  const { data: group, error: groupError } = await supabase.from("groups").select(SHEET_READS.groups).eq("id", input.groupId).maybeSingle();
  if (groupError) return { ok: false, status: 502, error: "Couldn't read the group. Try again." };
  if (!group) return { ok: false, status: 404, error: "That group wasn't found." };
  if (group.group_kind === "one_on_one") return { ok: false, status: 409, error: "A team sheet is for a team or a class, not a one-on-one client." };

  const read = await readPrograms(supabase, input.groupId);
  if ("error" in read) return { ok: false, status: 502, error: read.error };

  // which workouts go on which days
  const placed: { workout: WorkoutRow; date: string }[] = [];
  if (input.mode === "day") {
    if (!isDateKey(input.date)) return { ok: false, status: 400, error: "Choose a date." };
    const w = read.workouts.find((x) => x.id === input.workoutId);
    if (!w) return { ok: false, status: 404, error: read.programs.length === 0 ? "This group has no active program yet." : "That workout is not in the group's active program any more. Choose another." };
    placed.push({ workout: w, date: input.date });
  } else {
    if (!isDateKey(input.start)) return { ok: false, status: 400, error: "Choose the date the week starts." };
    const program = read.programs.find((p) => p.id === input.programId);
    if (!program) return { ok: false, status: 404, error: read.programs.length === 0 ? "This group has no active program yet." : "That program is not active any more. Choose another." };
    const weekWorkouts = read.workouts.filter((w) => w.program_id === program.id && (w.week_number ?? 1) === input.week);
    if (weekWorkouts.length === 0) return { ok: false, status: 404, error: `${program.name} has no Week ${input.week}.` };
    // the chosen training days, in the order of the Monday-to-Sunday week that holds the start date
    const window = weekDates(input.start);
    const chosen = window.filter((d) => input.days.includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
    if (chosen.length === 0) return { ok: false, status: 400, error: "Choose the days the team trains." };
    if (weekWorkouts.length > chosen.length) return { ok: false, status: 422, error: `Week ${input.week} has ${weekWorkouts.length} workouts but only ${chosen.length} training day${chosen.length === 1 ? "" : "s"} are chosen. Choose more days, or use a Day sheet.` };
    weekWorkouts.forEach((w, i) => placed.push({ workout: w, date: chosen[i] }));
  }

  const exerciseRead = await readRowsByIds(placed.map((p) => p.workout.id), (ids: string[]) => (from: number, to: number) =>
    supabase
      .from("group_workout_exercises")
      .select(SHEET_READS.exercises)
      .in("workout_id", ids)
      // the team's own exercises: an exercise written for one athlete (a per-client program) is not on the team's sheet
      .is("athlete_id", null)
      .order("exercise_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (exerciseRead.error) return { ok: false, status: 502, error: "Couldn't read the exercises. Try again." };
  const byWorkout = new Map<string, ExerciseRow[]>();
  for (const e of (exerciseRead.data ?? []) as ExerciseRow[]) byWorkout.set(e.workout_id, [...(byWorkout.get(e.workout_id) ?? []), e]);

  // one block per day; two workouts on the same day share it
  const days: SheetDay[] = [];
  for (const date of Array.from(new Set(placed.map((p) => p.date))).sort()) {
    const todays = placed.filter((p) => p.date === date);
    const exercises: SheetExercise[] = [];
    for (const { workout } of todays) {
      for (const e of byWorkout.get(workout.id) ?? []) {
        const sets = [...(e.group_workout_exercise_sets ?? [])].sort((a, b) => (a.set_order ?? 0) - (b.set_order ?? 0));
        const p = describePrescription({ sets });
        // What the exercise records decides how it is read: weight (and reps) are read; reps alone are read as reps; anything with neither (a plank's time, a jump's height, a sprint) goes in Notes for now.
        const tracked = e.tracked_fields && e.tracked_fields.length > 0 ? e.tracked_fields : ["reps", "weight"];
        const hasWeight = tracked.includes("weight");
        const hasReps = tracked.includes("reps");
        const unread = !hasWeight && !hasReps;
        const repsOnly = !hasWeight && hasReps;
        exercises.push({ id: e.id, name: (e.display_name ?? "").trim() || e.exercise_name, prescription: repsOnly ? `${p.text} reps` : p.text, sets: p.sets, reps: p.reps, unread, repsOnly });
      }
    }
    days.push({ date, label: dayLabel(date), title: todays.map((p) => (p.workout.title ?? "").trim()).filter(Boolean).join(" / ").slice(0, 40), exercises });
  }
  const total = days.reduce((s, d) => s + d.exercises.length, 0);
  if (total === 0) return { ok: false, status: 404, error: "That workout has no exercises for the team yet." };
  if (total > MAX_EXERCISES_TOTAL) return { ok: false, status: 422, error: `That is ${total} exercises, more than one sheet can carry (${MAX_EXERCISES_TOTAL}). Choose a Day sheet, or a shorter week.` };

  const roster = await pageAll((from: number, to: number) => supabase.from("group_memberships").select(SHEET_READS.roster).eq("group_id", input.groupId).eq("role", "athlete").order("profile_id").range(from, to), { maxPages: 10 });
  if (roster.failed) return { ok: false, status: 502, error: "Couldn't read the roster. Try again." };
  if (roster.truncated || roster.rows.length > MAX_ATHLETES) return { ok: false, status: 422, error: `That roster is larger than one sheet run can carry (${MAX_ATHLETES} athletes).` };
  if (roster.rows.length === 0) return { ok: false, status: 404, error: "There are no athletes in this group yet." };
  const athletes = roster.rows.map((r: any) => ({ id: r.profile_id as string, fullName: ((Array.isArray(r.profiles) ? r.profiles[0] : r.profiles)?.full_name as string | null) ?? "" }));
  const racks = makeRacks(athletes, input.perRack);
  if (racks.length > MAX_RACKS) return { ok: false, status: 422, error: "That is more racks than one run can carry. Put more athletes on each rack." };

  return { ok: true, model: { groupId: input.groupId, groupName: String(group.name ?? "Team"), mode: input.mode, unit: input.unit, days, racks } };
}
