import { createServerClient } from "@/lib/supabase/server";
import { ProgramDayPicker } from "@/components/shared/program-day-picker";
import { computeScheduledDates, formatShortDate, isLocked, isSameDay, unlockDate, type VisibilityWindow } from "@/lib/program-schedule";
import { getGroupCoachTimezone, nowInZone } from "@/lib/timezone";
import { exerciseLine, type PlainDay, type PlainWeek } from "@/lib/program-plain-view";
import { loadDoneAt, pickUpWhereLeftOff, weekOf } from "@/lib/program-pickup";
import { demoThumbPath, findDemo, type DemoRow } from "@/lib/exercise-demo";

// The plain program view on a phone, for the coach, a client, and the coach's own training: every week, pick the week, tap a day, see the workout, start it. Read-only; the builder is "Edit program".
export async function ProgramPlainView({
  groupId,
  programId,
  userId,
  isCoach,
  program,
  subjectId: subjectOverride,
  backHref,
  workoutHrefBase,
  startLabel,
}: {
  groupId: string;
  programId: string;
  userId: string;
  isCoach: boolean;
  // The coach logging for a client: whose workouts are checked off, where Back goes, where a day's button goes, and what it says.
  subjectId?: string;
  backHref?: string;
  workoutHrefBase?: string;
  startLabel?: string;
  program: { name: string; start_date: string | null; training_days: number[] | null; visibility_window: VisibilityWindow | null; athlete_id: string | null };
}) {
  const supabase = await createServerClient();
  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, scheduled_date, group_workout_exercises ( exercise_name, exercise_order, notes, athlete_id, group_workout_exercise_sets ( target_reps, target_time_seconds ) )")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  const rows = (workouts ?? []) as any[];
  // Whose workouts are checked off: the client the program is for, else the person looking (their own training).
  const subjectId = subjectOverride ?? program.athlete_id ?? userId;
  const [{ data: sessionRows }, { data: coachSeat }] = await Promise.all([
    rows.length > 0
      ? supabase.from("athlete_sessions").select("workout_id, completed_at").eq("athlete_id", subjectId).eq("status", "completed").in("workout_id", rows.map((w) => w.id))
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "coach").limit(1).maybeSingle(),
  ]);
  const lastDone = new Map<string, string>();
  for (const s of (sessionRows ?? []) as { workout_id: string; completed_at: string | null }[]) {
    if (!s.completed_at) continue;
    const prev = lastDone.get(s.workout_id);
    if (!prev || s.completed_at > prev) lastDone.set(s.workout_id, s.completed_at);
  }

  // The coach's exercise videos give each exercise its picture (a YouTube video's still; an uploaded video shows none).
  const demoLibrary: DemoRow[] = [];
  const coachId = (coachSeat as { profile_id?: string } | null)?.profile_id ?? null;
  if (coachId) {
    const { data: libraryRows } = await supabase.from("exercise_library").select("name, video_path, youtube_url").eq("created_by", coachId);
    for (const r of (libraryRows ?? []) as any[]) demoLibrary.push({ name: r.name, videoPath: r.video_path, youtubeUrl: r.youtube_url });
  }

  const hasSchedule = !!program.start_date && !!program.training_days && program.training_days.length > 0;
  const scheduled = hasSchedule
    ? computeScheduledDates(program.start_date!, program.training_days!, rows.map((w) => ({ id: w.id, scheduledDate: w.scheduled_date })))
    : new Map<string, Date>();
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const today = nowInZone(timezone);

  const byWeek = new Map<number, PlainWeek>();
  for (const w of rows) {
    const when = scheduled.get(w.id);
    const isToday = when ? isSameDay(when, today) : false;
    // The coach's own setting "show days ahead" is the only lock, and never for the coach.
    const locked = !isCoach && when ? isLocked(when, today, program.visibility_window ?? undefined) : false;
    let totalSets = 0;
    const exercises = ((w.group_workout_exercises ?? []) as any[])
      .filter((e) => e.athlete_id == null || e.athlete_id === subjectId || e.athlete_id === userId)
      .sort((a, b) => a.exercise_order - b.exercise_order)
      .map((e) => {
        const sets = ((e.group_workout_exercise_sets ?? []) as any[]).map((s) => ({ target_reps: (s.target_reps as string | null) ?? null, target_time_seconds: (s.target_time_seconds as number | null) ?? null }));
        totalSets += Math.max(1, sets.length);
        const demo = findDemo(demoLibrary, e.exercise_name as string);
        return { name: e.exercise_name as string, line: exerciseLine(sets), note: (e.notes as string | null)?.trim() || null, thumbUrl: demo ? demoThumbPath(demo.youtubeUrl) : null };
      });
    const week: PlainWeek = byWeek.get(w.week_number) ?? { weekNumber: w.week_number, days: [] };
    const day: PlainDay = {
      id: w.id,
      dayIndex: w.day_index,
      title: w.title ?? "",
      dateLabel: when ? formatShortDate(when) : null,
      isToday,
      lockedLabel: locked && when ? `Unlocks ${formatShortDate(unlockDate(when, program.visibility_window ?? undefined))}` : null,
      completedAt: lastDone.get(w.id) ?? null,
      // A locked day (the coach's "show days ahead") sends no exercises to the browser at all, only how many there are.
      exerciseCount: exercises.length,
      exercises: locked ? [] : exercises,
      totalSets: locked ? 0 : totalSets,
    };
    week.days.push(day);
    byWeek.set(w.week_number, week);
  }
  const weeks = [...byWeek.values()].sort((a, b) => a.weekNumber - b.weekNumber);
  // Opens where they left off: the week and day right AFTER the workout completed most recently, in program order. Not tied to dates; earlier weeks and skipped days stay one tap away.
  const { doneAt } = await loadDoneAt(supabase, subjectId, rows.map((w) => w.id as string));
  const pick = pickUpWhereLeftOff(rows, doneAt);
  const current = pick.kind === "next" ? weekOf(pick.workout) : pick.kind === "complete" ? weekOf(pick.lastDone) : null;
  const upNextDayId = pick.kind === "next" ? pick.workout.id : null;

  return (
    <ProgramDayPicker
      title={program.name}
      weeks={weeks}
      currentWeek={current}
      upNextDayId={upNextDayId}
      programComplete={pick.kind === "complete"}
      backHref={backHref ?? (isCoach ? "/programs" : `/groups/${groupId}`)}
      editHref={isCoach && !workoutHrefBase ? `/groups/${groupId}/programs/${programId}?edit=1` : null}
      workoutHrefBase={workoutHrefBase ?? `/groups/${groupId}/workouts`}
      startLabel={startLabel}
      canEdit={isCoach && !workoutHrefBase}
      isCoachViewing={isCoach && !!program.athlete_id && program.athlete_id !== userId}
      nowIso={new Date().toISOString()}
    />
  );
}
