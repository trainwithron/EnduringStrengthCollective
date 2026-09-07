import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { HabitManager, type ClientHabit } from "@/components/coach/desktop/habit-manager";
import { computeScheduledDates } from "@/lib/program-schedule";
import { isHabitDueOn } from "@/lib/habits";

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function monthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export default async function ClientCalendarPage({
  params,
  searchParams,
}: {
  params: { groupId: string; athleteId: string };
  searchParams: { month?: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          Only coaches can view a client&apos;s calendar.
        </p>
      </main>
    );
  }

  const { data: athleteMembership } = await supabase
    .from("group_memberships")
    .select("profiles ( full_name )")
    .eq("group_id", params.groupId)
    .eq("profile_id", params.athleteId)
    .maybeSingle();

  if (!athleteMembership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">This client isn&apos;t in this group.</p>
      </main>
    );
  }

  const athleteName = (athleteMembership.profiles as any)?.full_name ?? "Client";

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const backHref = `/groups/${params.groupId}/athletes/${params.athleteId}`;

  const today = new Date();
  const monthParam = searchParams.month;
  let year = today.getFullYear();
  let monthIndex = today.getMonth();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    year = y;
    monthIndex = m - 1;
  }

  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const lastOfMonth = new Date(year, monthIndex, daysInMonth);
  const leadingBlanks = firstOfMonth.getDay();

  const rangeStart = dateKey(firstOfMonth);
  const rangeEnd = dateKey(lastOfMonth);

  // Program-computed schedule (read-only reference — the shared group
  // program keeps working exactly as it does today).
  const { data: program } = await supabase
    .from("programs")
    .select("id, start_date, training_days")
    .eq("group_id", params.groupId)
    .eq("is_active", true)
    .maybeSingle();

  let workoutByDateKey = new Map<string, { id: string; title: string }>();
  let loggedIds = new Set<string>();
  if (program) {
    const { data: workouts } = await supabase
      .from("workouts")
      .select("id, title, week_number, day_index")
      .eq("program_id", program.id)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true });

    if (workouts && program.start_date && program.training_days?.length) {
      const scheduledDateByDayId = computeScheduledDates(
        program.start_date,
        program.training_days,
        workouts
      );
      for (const w of workouts) {
        const d = scheduledDateByDayId.get(w.id);
        if (d) workoutByDateKey.set(dateKey(d), { id: w.id, title: w.title });
      }
    }

    const { data: logs } = await supabase
      .from("workout_logs")
      .select("workout_id")
      .eq("athlete_id", params.athleteId)
      .in("workout_id", (workouts ?? []).map((w) => w.id));
    loggedIds = new Set((logs ?? []).map((l) => l.workout_id));
  }

  // Coach-assigned overrides for this athlete, this month.
  const { data: assignments } = await supabase
    .from("workout_assignments")
    .select("scheduled_date, note, workouts ( title )")
    .eq("athlete_id", params.athleteId)
    .gte("scheduled_date", rangeStart)
    .lte("scheduled_date", rangeEnd);
  const assignmentByDateKey = new Map<string, { title: string | null; note: string | null }>();
  for (const a of assignments ?? []) {
    assignmentByDateKey.set(a.scheduled_date, {
      title: (a.workouts as any)?.title ?? null,
      note: a.note,
    });
  }

  // This client's habits + this month's check-off status.
  const { data: habitRows } = await supabase
    .from("client_habits")
    .select("id, title, weekdays, active")
    .eq("athlete_id", params.athleteId)
    .eq("group_id", params.groupId)
    .order("created_at", { ascending: true });
  const habits: ClientHabit[] = (habitRows ?? []).map((h) => ({
    id: h.id,
    title: h.title,
    weekdays: h.weekdays,
    active: h.active,
  }));
  const activeHabits = habits.filter((h) => h.active);

  const { data: habitLogRows } = await supabase
    .from("habit_logs")
    .select("habit_id, log_date, completed_at")
    .in("habit_id", habits.map((h) => h.id))
    .gte("log_date", rangeStart)
    .lte("log_date", rangeEnd);
  const completedHabitDates = new Set(
    (habitLogRows ?? []).filter((l) => l.completed_at).map((l) => `${l.habit_id}:${l.log_date}`)
  );

  // Daily macro targets this month.
  const { data: macroRows } = await supabase
    .from("daily_macros")
    .select("log_date, calories, protein_g, carbs_g, fat_g")
    .eq("athlete_id", params.athleteId)
    .gte("log_date", rangeStart)
    .lte("log_date", rangeEnd);
  const macrosByDateKey = new Map((macroRows ?? []).map((m) => [m.log_date, m]));

  // The coach's own bookings this month, across every client — an overlay
  // so scheduling for this athlete doesn't happen blind to the coach's own
  // day.
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("start_at")
    .eq("coach_id", user.id)
    .eq("status", "confirmed")
    .gte("start_at", firstOfMonth.toISOString())
    .lt("start_at", new Date(year, monthIndex + 1, 1).toISOString());
  const bookingCountByDateKey = new Map<string, number>();
  for (const b of bookingRows ?? []) {
    const k = dateKey(new Date(b.start_at));
    bookingCountByDateKey.set(k, (bookingCountByDateKey.get(k) ?? 0) + 1);
  }

  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthIndex, i + 1)),
  ];

  const prevMonth = new Date(year, monthIndex - 1, 1);
  const nextMonth = new Date(year, monthIndex + 1, 1);
  const prevHref = `${backHref}/calendar?month=${prevMonth.getFullYear()}-${String(
    prevMonth.getMonth() + 1
  ).padStart(2, "0")}`;
  const nextHref = `${backHref}/calendar?month=${nextMonth.getFullYear()}-${String(
    nextMonth.getMonth() + 1
  ).padStart(2, "0")}`;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="clients">
      <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
        &larr; Back to {athleteName}
      </Link>
      <h1 className="font-display font-bold text-2xl uppercase leading-tight mt-3 mb-6">
        {athleteName}&apos;s Calendar
      </h1>

      <div className="grid grid-cols-[1fr_280px] gap-8 items-start">
        <div>
          <div className="flex items-center justify-between mb-3">
            <Link href={prevHref} className="font-body text-xs text-rust uppercase tracking-wide">
              &larr; Prev
            </Link>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel">
              {monthLabel(year, monthIndex)}
            </h2>
            <Link href={nextHref} className="font-body text-xs text-rust uppercase tracking-wide">
              Next &rarr;
            </Link>
          </div>

          <div className="grid grid-cols-7 gap-px bg-steel/15 border border-steel/15">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="bg-graphite text-center font-body text-[10px] text-steel uppercase tracking-wide py-1.5"
              >
                {label}
              </div>
            ))}

            {cells.map((date, i) => {
              if (!date) return <div key={i} className="bg-graphite min-h-[92px]" />;

              const key = dateKey(date);
              const isToday = key === dateKey(today);
              const override = assignmentByDateKey.get(key);
              const programWorkout = workoutByDateKey.get(key);
              const done = programWorkout ? loggedIds.has(programWorkout.id) : false;
              const macros = macrosByDateKey.get(key);
              const bookingCount = bookingCountByDateKey.get(key) ?? 0;
              const dueHabits = activeHabits.filter((h) => isHabitDueOn(h.weekdays, date));

              return (
                <Link
                  key={i}
                  href={`${backHref}/calendar/${key}`}
                  className={`bg-graphite min-h-[92px] p-1.5 flex flex-col gap-0.5 hover:bg-surface/40 transition-colors ${
                    isToday ? "ring-1 ring-inset ring-rust" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-body text-[10px] ${
                        isToday ? "text-rust font-bold" : "text-steel"
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {bookingCount > 0 && (
                      <span className="font-body text-[9px] text-steel">
                        📅 {bookingCount}
                      </span>
                    )}
                  </div>
                  {override ? (
                    <span className="font-body text-[10px] leading-tight text-rust">
                      {override.title ?? override.note ?? "Assigned"}
                    </span>
                  ) : programWorkout ? (
                    <span
                      className={`font-body text-[10px] leading-tight ${
                        done ? "text-positive" : "text-chalk"
                      }`}
                    >
                      {programWorkout.title}
                    </span>
                  ) : null}
                  {macros?.calories != null && (
                    <span className="font-body text-[9px] text-steel">
                      {macros.calories}cal
                      {macros.protein_g != null && ` ${macros.protein_g}p`}
                      {macros.carbs_g != null && ` ${macros.carbs_g}c`}
                      {macros.fat_g != null && ` ${macros.fat_g}f`}
                    </span>
                  )}
                  {dueHabits.slice(0, 2).map((h) => (
                    <span
                      key={h.id}
                      className={`font-body text-[9px] leading-tight truncate ${
                        completedHabitDates.has(`${h.id}:${key}`) ? "text-positive" : "text-steel"
                      }`}
                    >
                      {completedHabitDates.has(`${h.id}:${key}`) ? "✓ " : "· "}
                      {h.title}
                    </span>
                  ))}
                  {dueHabits.length > 2 && (
                    <span className="font-body text-[9px] text-steel">
                      +{dueHabits.length - 2} more
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        <HabitManager athleteId={params.athleteId} groupId={params.groupId} initialHabits={habits} />
      </div>

      {(macrosByDateKey.size > 0 || activeHabits.length > 0 || assignmentByDateKey.size > 0) && (
        <section className="mt-8">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            This month&apos;s assignments
          </h2>
          <div className="divide-y divide-steel/15">
            {cells
              .filter((d): d is Date => {
                if (!d) return false;
                const k = dateKey(d);
                return (
                  assignmentByDateKey.has(k) ||
                  macrosByDateKey.has(k) ||
                  activeHabits.some((h) => isHabitDueOn(h.weekdays, d))
                );
              })
              .map((date) => {
                const key = dateKey(date);
                const override = assignmentByDateKey.get(key);
                const programWorkout = workoutByDateKey.get(key);
                const macros = macrosByDateKey.get(key);
                const dueHabits = activeHabits.filter((h) => isHabitDueOn(h.weekdays, date));
                return (
                  <div key={key} className="py-2.5 flex items-start gap-4">
                    <span className="font-body text-xs text-steel w-16 shrink-0 pt-0.5">
                      {date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <span className="font-body text-sm flex-1 min-w-0">
                      {override?.title ?? programWorkout?.title ?? (
                        <span className="text-steel">No workout</span>
                      )}
                    </span>
                    <span className="font-body text-xs text-steel flex-1 min-w-0">
                      {macros?.calories != null
                        ? `${macros.calories} cal${macros.protein_g != null ? ` · ${macros.protein_g}p` : ""}${
                            macros.carbs_g != null ? ` · ${macros.carbs_g}c` : ""
                          }${macros.fat_g != null ? ` · ${macros.fat_g}f` : ""}`
                        : "—"}
                    </span>
                    <span className="font-body text-xs text-steel flex-1 min-w-0">
                      {dueHabits.length > 0
                        ? dueHabits
                            .map(
                              (h) =>
                                `${h.title}${
                                  completedHabitDates.has(`${h.id}:${key}`) ? " ✓" : ""
                                }`
                            )
                            .join(", ")
                        : "—"}
                    </span>
                  </div>
                );
              })}
          </div>
        </section>
      )}
    </CoachDesktopShell>
  );
}
