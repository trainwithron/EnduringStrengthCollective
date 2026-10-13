import { createServerClient } from "@/lib/supabase/server";
import { ProgramDayPicker } from "@/components/shared/program-day-picker";
import { computeScheduledDates, formatShortDate, isLocked, isSameDay, unlockDate, type VisibilityWindow } from "@/lib/program-schedule";
import { getGroupCoachTimezone, nowInZone } from "@/lib/timezone";
import { currentWeekFor, exerciseLine, type PlainWeek } from "@/lib/program-plain-view";

// The plain program view on a phone, for the coach, a client, and the coach's own training: every week, pick the week and the day, see the workout, log it. Read-only; the builder is "Edit program".
export async function ProgramPlainView({
  groupId,
  programId,
  userId,
  isCoach,
  program,
}: {
  groupId: string;
  programId: string;
  userId: string;
  isCoach: boolean;
  program: { name: string; start_date: string | null; training_days: number[] | null; visibility_window: VisibilityWindow | null };
}) {
  const supabase = await createServerClient();
  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, scheduled_date, group_workout_exercises ( exercise_name, exercise_order, notes, athlete_id, group_workout_exercise_sets ( target_reps, target_time_seconds ) )")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  const rows = (workouts ?? []) as any[];
  const hasSchedule = !!program.start_date && !!program.training_days && program.training_days.length > 0;
  const scheduled = hasSchedule
    ? computeScheduledDates(program.start_date!, program.training_days!, rows.map((w) => ({ id: w.id, scheduledDate: w.scheduled_date })))
    : new Map<string, Date>();
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const today = nowInZone(timezone);

  const byWeek = new Map<number, PlainWeek>();
  let todayWeek: number | null = null;
  for (const w of rows) {
    const when = scheduled.get(w.id);
    const isToday = when ? isSameDay(when, today) : false;
    if (isToday) todayWeek = w.week_number;
    // The coach's own setting "show days ahead" is the only lock, and never for the coach.
    const locked = !isCoach && when ? isLocked(when, today, program.visibility_window ?? undefined) : false;
    const exercises = ((w.group_workout_exercises ?? []) as any[])
      .filter((e) => e.athlete_id == null || e.athlete_id === userId)
      .sort((a, b) => a.exercise_order - b.exercise_order)
      .map((e) => ({
        name: e.exercise_name as string,
        line: exerciseLine(((e.group_workout_exercise_sets ?? []) as any[]).map((s) => ({ target_reps: s.target_reps ?? null, target_time_seconds: s.target_time_seconds ?? null }))),
        note: (e.notes as string | null)?.trim() || null,
      }));
    const week: PlainWeek = byWeek.get(w.week_number) ?? { weekNumber: w.week_number, days: [] };
    week.days.push({
      id: w.id,
      dayIndex: w.day_index,
      title: w.title ?? "",
      dateLabel: when ? formatShortDate(when) : null,
      isToday,
      lockedLabel: locked && when ? `Unlocks ${formatShortDate(unlockDate(when, program.visibility_window ?? undefined))}` : null,
      exercises,
    });
    byWeek.set(w.week_number, week);
  }
  const weeks = [...byWeek.values()].sort((a, b) => a.weekNumber - b.weekNumber);
  const current = currentWeekFor({ startDate: program.start_date, weekNumbers: weeks.map((w) => w.weekNumber), todayWeekFromSchedule: todayWeek, today });

  return (
    <ProgramDayPicker
      title={program.name}
      weeks={weeks}
      currentWeek={current}
      backHref={isCoach ? `/groups/${groupId}/programs` : `/groups/${groupId}`}
      editHref={isCoach ? `/groups/${groupId}/programs/${programId}?edit=1` : null}
      workoutHrefBase={`/groups/${groupId}/workouts`}
      canEdit={isCoach}
      isCoachViewing={isCoach}
    />
  );
}
