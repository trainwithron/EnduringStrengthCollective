import type { SupabaseClient } from "@supabase/supabase-js";
import { loadProgramDayContexts, loadAssignedWorkouts, resolveSessionsForDate, contextWorkoutIds, type ProgramDayContext, type AssignedWorkout } from "./program-day-contexts";
import { dateKeyOf, type DayWorkoutStatus } from "./athlete-day-schedule";
import { loadDoneAt } from "./program-pickup";
import { programPickups } from "./home-programs";
import { pickupLabel } from "./program-pickup";
import { dateKeyInZone, zonedTimeToUtc, addDaysToKey } from "./timezone";
import { formatInTimezone } from "./format-in-timezone";

// The client's ONE Calendar (Ron, Oct 19: "I also want a calendar [that] is not tied to a program"). Each day shows:
//   - the workouts of EVERY active program that has a start date and training days (a program the coach did not put on dates is never placed;
//     it is a card above the calendar instead, which opens the whole program where they left off),
//   - a workout the coach put on that one day (it replaces what the programs give that day, the rule Today already follows),
//   - a workout they logged that day that is not already shown,
//   - their own booked sessions with the coach.

export interface CalendarDayWorkout {
  workoutId: string;
  title: string;
  status: DayWorkoutStatus;
  heading: string;
}
export interface CalendarDay {
  workouts: CalendarDayWorkout[];
  sessions: { id: string; time: string }[];
}

export interface CalendarInputs {
  dated: ProgramDayContext[];
  loggedIds: Set<string>;
  assigned: Map<string, AssignedWorkout>;
  logged: { workoutId: string; title: string; dateKey: string }[];
  bookings: { id: string; dateKey: string; time: string }[];
}

// Pure: one entry per date key in `dates`.
export function buildCalendarDays(input: CalendarInputs, dates: Date[], today: Date): Map<string, CalendarDay> {
  const out = new Map<string, CalendarDay>();
  const todayKey = dateKeyOf(today);
  for (const date of dates) {
    const key = dateKeyOf(date);
    const workouts: CalendarDayWorkout[] = resolveSessionsForDate(input.dated, input.loggedIds, date, today, key === todayKey, input.assigned).map((s) => ({
      workoutId: s.workoutId as string,
      title: s.title ?? "Workout",
      status: s.status,
      heading: s.heading,
    }));
    for (const l of input.logged) {
      if (l.dateKey === key && !workouts.some((w) => w.workoutId === l.workoutId)) workouts.push({ workoutId: l.workoutId, title: l.title, status: "done", heading: "Logged" });
    }
    const sessions = input.bookings.filter((b) => b.dateKey === key).map((b) => ({ id: b.id, time: b.time }));
    out.set(key, { workouts, sessions });
  }
  return out;
}

export interface UndatedProgramCard {
  id: string;
  name: string;
  coverImagePath: string | null;
  workoutCount: number;
  // "Up next: Week 14, Day 2" (the workout right after the one done last), "Program complete" or "Nothing in it yet".
  upNext: string;
}

// Pure: the cards for programs with no dates, in the order the programs come.
export function undatedProgramCards(
  undated: ProgramDayContext[],
  workouts: { id: string; program_id: string; title: string | null; week_number: number | null; day_index: number | null }[],
  doneAt: ReadonlyMap<string, string>,
  covers: ReadonlyMap<string, string | null>
): UndatedProgramCard[] {
  const inputs = undated.map((c) => ({ id: c.program.id, name: c.program.name }));
  const pickups = programPickups(inputs, workouts, doneAt);
  return undated.map((c) => {
    const pick = pickups.get(c.program.id);
    const label = pick ? pickupLabel(pick) : "Nothing in it yet";
    return {
      id: c.program.id,
      name: c.program.label?.trim() || c.program.name,
      coverImagePath: covers.get(c.program.id) ?? null,
      workoutCount: workouts.filter((w) => w.program_id === c.program.id).length,
      upNext: pick?.kind === "next" ? `Up next: ${label}` : label,
    };
  });
}

export interface ClientCalendarData {
  days: Map<string, CalendarDay>;
  undated: UndatedProgramCard[];
}

// Reads everything for the dates shown (a month, a week, or one day) in the coach's time zone.
export async function loadClientCalendar(
  supabase: SupabaseClient,
  input: { groupId: string; athleteId: string; timezone: string; dates: Date[]; today: Date; withUndated: boolean }
): Promise<ClientCalendarData> {
  const { groupId, athleteId, timezone, dates, today } = input;
  const fromKey = dateKeyOf(dates[0]);
  const toKey = dateKeyOf(dates[dates.length - 1]);
  const fromIso = zonedTimeToUtc(fromKey, "00:00", timezone).toISOString();
  const toIso = zonedTimeToUtc(addDaysToKey(toKey, 1), "00:00", timezone).toISOString();

  const contexts = await loadProgramDayContexts(supabase, groupId, athleteId);
  const dated = contexts.filter((c) => !c.unscheduled);
  const undated = contexts.filter((c) => c.unscheduled);

  const [{ doneAt }, assigned, { data: logRows }, { data: bookingRows }] = await Promise.all([
    loadDoneAt(supabase, athleteId, contextWorkoutIds(dated)),
    loadAssignedWorkouts(supabase, athleteId, groupId, fromKey, toKey),
    supabase.from("workout_logs").select("workout_id, created_at, workouts ( title )").eq("athlete_id", athleteId).eq("group_id", groupId).gte("created_at", fromIso).lt("created_at", toIso),
    supabase.from("bookings").select("id, start_at").eq("athlete_id", athleteId).eq("group_id", groupId).eq("status", "confirmed").gte("start_at", fromIso).lt("start_at", toIso).order("start_at", { ascending: true }),
  ]);

  const logged = ((logRows ?? []) as unknown as { workout_id: string | null; created_at: string; workouts: { title: string } | { title: string }[] | null }[])
    .filter((r) => r.workout_id)
    .map((r) => {
      const w = Array.isArray(r.workouts) ? r.workouts[0] : r.workouts;
      return { workoutId: r.workout_id as string, title: w?.title ?? "Workout", dateKey: dateKeyInZone(timezone, new Date(r.created_at)) };
    });
  const bookings = ((bookingRows ?? []) as { id: string; start_at: string }[]).map((b) => ({
    id: b.id,
    dateKey: dateKeyInZone(timezone, new Date(b.start_at)),
    time: formatInTimezone(b.start_at, timezone, "time"),
  }));
  const days = buildCalendarDays({ dated, loggedIds: new Set(doneAt.keys()), assigned, logged, bookings }, dates, today);

  let cards: UndatedProgramCard[] = [];
  if (input.withUndated && undated.length > 0) {
    const ids = undated.map((c) => c.program.id);
    const [{ data: workoutRows }, { data: coverRows }] = await Promise.all([
      supabase.from("workouts").select("id, program_id, title, week_number, day_index").in("program_id", ids),
      supabase.from("programs").select("id, cover_image_path").in("id", ids),
    ]);
    const rows = (workoutRows ?? []) as { id: string; program_id: string; title: string | null; week_number: number | null; day_index: number | null }[];
    const { doneAt: undatedDone } = await loadDoneAt(supabase, athleteId, rows.map((w) => w.id));
    const covers = new Map(((coverRows ?? []) as { id: string; cover_image_path: string | null }[]).map((r) => [r.id, r.cover_image_path]));
    cards = undatedProgramCards(undated, rows, undatedDone, covers);
  }
  return { days, undated: cards };
}
