import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { computeScheduledDates, isSameDay, isLocked } from "@/lib/program-schedule";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { Lock } from "lucide-react";

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

function weekLabel(weekStart: Date, weekEnd: Date): string {
  const startStr = weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${startStr} – ${endStr}`;
}

function parseDateParam(value: string | undefined, fallback: Date): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  return fallback;
}

export default async function ProgramCalendarPage({
  params,
  searchParams,
}: {
  params: { groupId: string; programId: string };
  searchParams: { month?: string; view?: string; week?: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!membership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This program isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  // A coach on a phone tracks their own completions here too, same as an
  // athlete — booking (which is a client booking *with* their coach)
  // stays athlete-only below, that part genuinely doesn't apply to them.
  const showMobileView = membership.role === "athlete" || prefersAthleteStyleView();

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, start_date, training_days, visibility_window")
    .eq("id", params.programId)
    .eq("group_id", params.groupId)
    .single();

  if (!program) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This program isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  const backHref = `/groups/${params.groupId}/programs/${params.programId}`;

  if (!program.start_date || !program.training_days || program.training_days.length === 0) {
    return (
      <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
        <header className="px-5 pt-8 pb-6 border-b border-steel/20">
          <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
            &larr; Back to program
          </Link>
          <h1 className="font-display font-bold text-4xl leading-none mt-3 uppercase">
            {program.name}
          </h1>
        </header>
        <p className="font-body text-sm text-steel px-5 py-6 max-w-[50ch]">
          Set a start date and training days on this program to see it as a calendar.
        </p>
        {showMobileView && (
          <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
        )}
      </main>
    );
  }

  const { data: workouts } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, group_workout_exercises(count)")
    .eq("program_id", params.programId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  const scheduledDateByDayId = computeScheduledDates(
    program.start_date,
    program.training_days,
    workouts ?? []
  );

  let loggedIds = new Set<string>();
  if (showMobileView) {
    const { data: logs } = await supabase
      .from("workout_logs")
      .select("workout_id")
      .eq("athlete_id", user.id)
      .in("workout_id", (workouts ?? []).map((w) => w.id));
    loggedIds = new Set((logs ?? []).map((l) => l.workout_id));
  }

  const workoutByDateKey = new Map<string, any>();
  for (const w of (workouts ?? []) as any[]) {
    const d = scheduledDateByDayId.get(w.id);
    if (d) workoutByDateKey.set(dateKey(d), w);
  }

  // Booking is additive: empty (no-workout) day cells only become
  // clickable once this group's coach has actually configured recurring
  // hours — otherwise every cell behaves exactly as it did before booking
  // existed.
  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", params.groupId)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  let hasAvailability = false;
  let upcomingBookings: { id: string; start_at: string }[] = [];

  if (coachMembership) {
    const { count } = await supabase
      .from("coach_availability_windows")
      .select("id", { count: "exact", head: true })
      .eq("coach_id", coachMembership.profile_id);
    hasAvailability = (count ?? 0) > 0;

    if (membership.role === "athlete" && hasAvailability) {
      const { data: bookingRows } = await supabase
        .from("bookings")
        .select("id, start_at")
        .eq("coach_id", coachMembership.profile_id)
        .eq("athlete_id", user.id)
        .eq("status", "confirmed")
        .gte("start_at", new Date().toISOString())
        .order("start_at", { ascending: true });
      upcomingBookings = bookingRows ?? [];
    }
  }

  const today = new Date();
  const view = searchParams.view === "week" ? "week" : "month";
  const monthParam = searchParams.month; // "YYYY-MM"
  let year = today.getFullYear();
  let monthIndex = today.getMonth();
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split("-").map(Number);
    year = y;
    monthIndex = m - 1;
  }

  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();

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

  // Week view is keyed off its own anchor date, independent of the month
  // grid's year/monthIndex — a visible week routinely spans a month
  // boundary, so it gets its own date range rather than reusing the
  // month's.
  const weekAnchor = parseDateParam(searchParams.week, today);
  const weekStart = new Date(weekAnchor);
  weekStart.setDate(weekAnchor.getDate() - weekAnchor.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
  const prevWeek = new Date(weekStart);
  prevWeek.setDate(weekStart.getDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(weekStart.getDate() + 7);
  const prevWeekHref = `${backHref}/calendar?view=week&week=${dateKey(prevWeek)}`;
  const nextWeekHref = `${backHref}/calendar?view=week&week=${dateKey(nextWeek)}`;
  const monthViewHref = `${backHref}/calendar?month=${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const weekViewHref = `${backHref}/calendar?view=week&week=${dateKey(weekStart)}`;

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back to program
        </Link>
        <h1 className="font-display font-bold text-4xl leading-none mt-3 uppercase">
          {program.name}
        </h1>
      </header>

      {upcomingBookings.length > 0 && (
        <section className="px-5 pt-6">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Your upcoming sessions
          </h2>
          <div className="divide-y divide-steel/15">
            {upcomingBookings.map((b) => {
              const start = new Date(b.start_at);
              return (
                <div key={b.id} className="py-2 flex items-center justify-between">
                  <span className="font-body text-sm">
                    {start.toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    &middot;{" "}
                    {start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </span>
                  <CancelBookingButton bookingId={b.id} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex items-center gap-1 px-5 pt-6">
        <Link
          href={monthViewHref}
          className={`h-8 px-3 flex items-center font-body text-xs border ${
            view === "month"
              ? "bg-rust text-graphite border-rust"
              : "border-steel/30 text-steel active:border-rust active:text-rust"
          }`}
        >
          Month
        </Link>
        <Link
          href={weekViewHref}
          className={`h-8 px-3 flex items-center font-body text-xs border ${
            view === "week"
              ? "bg-rust text-graphite border-rust"
              : "border-steel/30 text-steel active:border-rust active:text-rust"
          }`}
        >
          Week
        </Link>
      </div>

      {view === "month" ? (
        <>
          <div className="flex items-center justify-between px-5 pt-4">
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

          <div className="grid grid-cols-7 gap-px bg-steel/15 mt-4 mx-5 border border-steel/15">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="bg-graphite text-center font-body text-[10px] text-steel uppercase tracking-wide py-1.5"
              >
                {label}
              </div>
            ))}

            {cells.map((date, i) => {
              if (!date) return <div key={i} className="bg-graphite min-h-[64px]" />;

              const w = workoutByDateKey.get(dateKey(date));
              const isToday = isSameDay(date, today);
              const done = w ? loggedIds.has(w.id) : false;
              const locked =
                membership.role === "athlete" && w
                  ? isLocked(date, today, program.visibility_window) && !done
                  : false;

              const cellContent = (
                <>
                  <span
                    className={`font-body text-[10px] ${
                      isToday ? "text-rust font-bold" : "text-steel"
                    }`}
                  >
                    {date.getDate()}
                  </span>
                  {w && (
                    <span
                      className={`font-body text-[10px] leading-tight mt-0.5 ${
                        locked ? "text-steel flex items-center gap-0.5" : "text-chalk"
                      }`}
                    >
                      {locked && <Lock className="w-2.5 h-2.5 shrink-0" />}
                      {w.title}
                    </span>
                  )}
                  {w && done && (
                    <span className="font-body text-[9px] text-positive mt-0.5">Done</span>
                  )}
                </>
              );

              const cellClass = `bg-graphite min-h-[64px] p-1.5 flex flex-col ${
                isToday ? "ring-1 ring-inset ring-rust" : ""
              }`;

              if (w && !locked) {
                return (
                  <Link
                    key={i}
                    href={`/groups/${params.groupId}/workouts/${w.id}`}
                    className={cellClass}
                  >
                    {cellContent}
                  </Link>
                );
              }

              if (!w && hasAvailability) {
                return (
                  <Link
                    key={i}
                    href={`${backHref}/calendar/${dateKey(date)}`}
                    className={cellClass}
                  >
                    {cellContent}
                  </Link>
                );
              }

              return (
                <div key={i} className={cellClass}>
                  {cellContent}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-5 pt-4">
            <Link href={prevWeekHref} className="font-body text-xs text-rust uppercase tracking-wide">
              &larr; Prev
            </Link>
            <h2 className="font-display uppercase text-sm tracking-wide text-steel">
              {weekLabel(weekStart, weekDays[6])}
            </h2>
            <Link href={nextWeekHref} className="font-body text-xs text-rust uppercase tracking-wide">
              Next &rarr;
            </Link>
          </div>

          {/* A week fits far better as a vertical day list on a phone than
              squeezed into seven narrow grid columns — same data, no
              horizontal cramping. */}
          <div className="mt-4 mx-5 divide-y divide-steel/15 border-y border-steel/15">
            {weekDays.map((date, i) => {
              const w = workoutByDateKey.get(dateKey(date));
              const isToday = isSameDay(date, today);
              const done = w ? loggedIds.has(w.id) : false;
              const locked =
                membership.role === "athlete" && w
                  ? isLocked(date, today, program.visibility_window) && !done
                  : false;
              const exerciseCount = w ? (w.group_workout_exercises?.[0]?.count ?? 0) : 0;

              const rowInner = (
                <>
                  <div className={`w-11 shrink-0 text-center ${isToday ? "text-rust" : "text-steel"}`}>
                    <p className="font-body text-[10px] uppercase tracking-wide">{WEEKDAY_LABELS[i]}</p>
                    <p className="font-display font-bold text-lg leading-none">{date.getDate()}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    {w ? (
                      <>
                        <p className="font-body text-sm font-medium flex items-center gap-1.5">
                          {locked && <Lock className="w-3 h-3 shrink-0 text-steel" />}
                          {w.title}
                        </p>
                        <p className="font-body text-xs text-steel mt-0.5">
                          {done ? (
                            <span className="text-positive">Done</span>
                          ) : locked ? (
                            "Locked"
                          ) : (
                            `${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}`
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="font-body text-xs text-steel">Rest day</p>
                    )}
                  </div>
                </>
              );

              const rowClass = `flex items-center gap-3 py-3 ${isToday ? "bg-surface/40" : ""}`;

              if (w && !locked) {
                return (
                  <Link key={i} href={`/groups/${params.groupId}/workouts/${w.id}`} className={rowClass}>
                    {rowInner}
                  </Link>
                );
              }
              if (!w && hasAvailability) {
                return (
                  <Link key={i} href={`${backHref}/calendar/${dateKey(date)}`} className={rowClass}>
                    {rowInner}
                  </Link>
                );
              }
              return (
                <div key={i} className={rowClass}>
                  {rowInner}
                </div>
              );
            })}
          </div>
        </>
      )}

      {workouts?.length === 0 && (
        <p className="font-body text-sm text-steel px-5 pt-6">No workouts assigned yet.</p>
      )}

      {showMobileView && (
        <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
      )}
    </main>
  );
}
