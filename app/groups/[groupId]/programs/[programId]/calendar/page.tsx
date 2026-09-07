import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { computeScheduledDates, isSameDay, isLocked } from "@/lib/program-schedule";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
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

export default async function ProgramCalendarPage({
  params,
  searchParams,
}: {
  params: { groupId: string; programId: string };
  searchParams: { month?: string };
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

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, start_date, training_days")
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
        {membership.role === "athlete" && (
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
  if (membership.role === "athlete") {
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
                  <CancelBookingButton bookingId={b.id} groupId={params.groupId} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex items-center justify-between px-5 pt-6">
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
          const locked = membership.role === "athlete" && w ? isLocked(date, today) && !done : false;
          const exerciseCount = w ? (w.group_workout_exercises?.[0]?.count ?? 0) : 0;

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

      {workouts?.length === 0 && (
        <p className="font-body text-sm text-steel px-5 pt-6">No workouts assigned yet.</p>
      )}

      {membership.role === "athlete" && (
        <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
      )}
    </main>
  );
}
