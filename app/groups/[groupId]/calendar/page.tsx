import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CalendarPageTabs } from "@/components/coach/desktop/calendar-page-tabs";
import { CalendarGrid, type CalendarEventEntry } from "@/components/coach/desktop/calendar-grid";
import { CalendarClientList } from "@/components/coach/desktop/calendar-client-list";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { computeScheduledDates } from "@/lib/program-schedule";
import { ScheduleClientPicker } from "@/components/coach/schedule-client-picker";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { getEffectiveAthlete } from "@/lib/acting-as";

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

function formatTimeString(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export default async function CoachCalendarPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{
      month?: string;
      client?: string;
      view?: string;
      week?: string;
      reschedule?: string;
      scheduleFor?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = await createServerClient();
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

  const isCoach = membership?.role === "coach";
  // A coach "acting as" a client sees that client's own booking calendar —
  // isCoach above still reflects the real signed-in user, so the desktop
  // calendar branch further down stays correctly gated.
  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const isActingAsOther = effective.isActingAsOther;
  const athleteId = effective.athleteId;
  // A coach opening the installed home-screen app gets the same
  // athlete-style calendar a client gets — logging their own training
  // doesn't need the full booking/scheduling dashboard built for running
  // a business. The same coach in a plain browser tab still gets the
  // full desktop calendar below. Acting as a client always wins.
  const showMobileView = isActingAsOther || !isCoach || await prefersAthleteStyleView();

  let actingAsFullName: string | null = null;
  if (isActingAsOther) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", athleteId)
      .maybeSingle();
    actingAsFullName = profile?.full_name ?? "Client";
  }

  // A coach picking a client to schedule (mobile) — completely independent
  // of any program state, so it's handled before the self-training
  // redirect logic below ever runs (that logic would otherwise bounce a
  // coach with their own active program straight past this). Never shown
  // while acting as a client — that's the coach's own tool, not part of
  // the client's real experience.
  if (showMobileView && isCoach && !isActingAsOther) {
    const { data: clientMemberships } = await supabase
      .from("group_memberships")
      .select("profile_id, profiles ( full_name )")
      .eq("group_id", params.groupId)
      .eq("role", "athlete");

    const clientIds = (clientMemberships ?? []).map((m: any) => m.profile_id);
    const { data: creditRows } = await supabase
      .from("session_credits")
      .select("athlete_id, balance")
      .eq("group_id", params.groupId)
      .in("athlete_id", clientIds.length > 0 ? clientIds : [""]);
    const balanceByAthlete = new Map((creditRows ?? []).map((r) => [r.athlete_id, r.balance]));

    const scheduleClients = (clientMemberships ?? [])
      .map((m: any) => ({
        id: m.profile_id,
        fullName: m.profiles?.full_name ?? "Unknown",
        balance: balanceByAthlete.get(m.profile_id) ?? 0,
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    if (searchParams.scheduleFor) {
      const selected = scheduleClients.find((c) => c.id === searchParams.scheduleFor);
      if (!selected) {
        return (
          <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
            <ScheduleClientPicker groupId={params.groupId} clients={scheduleClients} />
            <p className="font-body text-sm text-steel px-5 pt-6">Client not found.</p>
            <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
          </main>
        );
      }

      const today = new Date();
      const year = today.getFullYear();
      const monthIndex = today.getMonth();
      const firstOfMonth = new Date(year, monthIndex, 1);
      const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
      const leadingBlanks = firstOfMonth.getDay();
      const cells: (Date | null)[] = [
        ...Array.from({ length: leadingBlanks }, () => null),
        ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthIndex, i + 1)),
      ];

      function isSameDayLocal(a: Date, b: Date): boolean {
        return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      }

      return (
        <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
          <ScheduleClientPicker groupId={params.groupId} clients={scheduleClients} selectedId={selected.id} />
          <div className="px-5 pt-4">
            <p className="font-body text-sm text-chalk">
              {selected.fullName} —{" "}
              <span className="text-steel">
                {selected.balance} {selected.balance === 1 ? "credit" : "credits"} left
              </span>
            </p>
            <p className="font-body text-xs text-steel mt-1">Tap a date to see and book open sessions.</p>
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
              if (!date) return <div key={i} className="bg-graphite min-h-[56px]" />;
              const isToday = isSameDayLocal(date, today);
              return (
                <Link
                  key={i}
                  href={`/groups/${params.groupId}/calendar/${dateKey(date)}?client=${selected.id}`}
                  className={`bg-graphite min-h-[56px] p-1.5 flex flex-col ${
                    isToday ? "ring-1 ring-inset ring-rust" : ""
                  }`}
                >
                  <span className={`font-body text-[10px] ${isToday ? "text-rust font-bold" : "text-steel"}`}>
                    {date.getDate()}
                  </span>
                </Link>
              );
            })}
          </div>
          <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
        </main>
      );
    }
  }

  if (showMobileView) {
    // A personal program assigned to this athlete wins over the group's
    // shared one — same precedence as lib/todays-workout.ts. Two queries,
    // not one `athlete_id = X or athlete_id is null` filter, since both
    // could be simultaneously active and .maybeSingle() would error on
    // more than one row.
    const { data: personalProgram } = await supabase
      .from("programs")
      .select("id, start_date, training_days")
      .eq("group_id", params.groupId)
      .eq("athlete_id", athleteId)
      .eq("is_active", true)
      .maybeSingle();

    const { data: sharedProgram } = personalProgram
      ? { data: null }
      : await supabase
          .from("programs")
          .select("id, start_date, training_days")
          .eq("group_id", params.groupId)
          .is("athlete_id", null)
          .eq("is_active", true)
          .maybeSingle();

    const program = personalProgram ?? sharedProgram;
    const programHasSchedule = !!(program?.start_date && program.training_days?.length);

    if (program && programHasSchedule) {
      const suffix = searchParams.reschedule ? `?reschedule=${searchParams.reschedule}` : "";
      redirect(`/groups/${params.groupId}/programs/${program.id}/calendar${suffix}`);
    }

    // No active program, or one exists but has no schedule set yet —
    // either way the calendar itself should still always be reachable, so
    // this renders a real month/week grid (bookings only, no workouts
    // plotted) rather than bouncing into that program's own calendar page
    // and dead-ending there. A client can still browse and book a session
    // with their coach here regardless of whether anything's assigned.
    const { data: coachMembership } = await supabase
      .from("group_memberships")
      .select("profile_id")
      .eq("group_id", params.groupId)
      .eq("role", "coach")
      .limit(1)
      .maybeSingle();

    let hasAvailability = false;
    let upcomingBookings: { id: string; start_at: string }[] = [];
    let creditBalance = 0;

    if (coachMembership) {
      const { count } = await supabase
        .from("coach_availability_windows")
        .select("id", { count: "exact", head: true })
        .eq("coach_id", coachMembership.profile_id);
      hasAvailability = (count ?? 0) > 0;

      if (hasAvailability) {
        const { data: bookingRows } = await supabase
          .from("bookings")
          .select("id, start_at")
          .eq("coach_id", coachMembership.profile_id)
          .eq("athlete_id", athleteId)
          .eq("status", "confirmed")
          .gte("start_at", new Date().toISOString())
          .order("start_at", { ascending: true });
        upcomingBookings = bookingRows ?? [];
      }

      const { data: creditsRow } = await supabase
        .from("session_credits")
        .select("balance")
        .eq("athlete_id", athleteId)
        .eq("group_id", params.groupId)
        .maybeSingle();
      creditBalance = creditsRow?.balance ?? 0;
    }

    const today = new Date();
    const view = searchParams.view === "week" ? "week" : "month";
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
    const leadingBlanks = firstOfMonth.getDay();
    const cells: (Date | null)[] = [
      ...Array.from({ length: leadingBlanks }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthIndex, i + 1)),
    ];

    const basePath = `/groups/${params.groupId}/calendar`;
    const rescheduleSuffix = searchParams.reschedule ? `&reschedule=${searchParams.reschedule}` : "";
    const prevMonth = new Date(year, monthIndex - 1, 1);
    const nextMonth = new Date(year, monthIndex + 1, 1);
    const prevHref = `${basePath}?month=${prevMonth.getFullYear()}-${String(
      prevMonth.getMonth() + 1
    ).padStart(2, "0")}${rescheduleSuffix}`;
    const nextHref = `${basePath}?month=${nextMonth.getFullYear()}-${String(
      nextMonth.getMonth() + 1
    ).padStart(2, "0")}${rescheduleSuffix}`;
    const monthViewHref = `${basePath}?month=${year}-${String(monthIndex + 1).padStart(2, "0")}${rescheduleSuffix}`;

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
    const prevWeekHref = `${basePath}?view=week&week=${dateKey(prevWeek)}${rescheduleSuffix}`;
    const nextWeekHref = `${basePath}?view=week&week=${dateKey(nextWeek)}${rescheduleSuffix}`;
    const weekViewHref = `${basePath}?view=week&week=${dateKey(weekStart)}${rescheduleSuffix}`;

    function isSameDayLocal(a: Date, b: Date): boolean {
      return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
      );
    }

    let scheduleClientsForCoach: { id: string; fullName: string; balance: number }[] = [];
    if (isCoach && !isActingAsOther) {
      const { data: cm } = await supabase
        .from("group_memberships")
        .select("profile_id, profiles ( full_name )")
        .eq("group_id", params.groupId)
        .eq("role", "athlete");
      const ids = (cm ?? []).map((m: any) => m.profile_id);
      const { data: cr } = await supabase
        .from("session_credits")
        .select("athlete_id, balance")
        .eq("group_id", params.groupId)
        .in("athlete_id", ids.length > 0 ? ids : [""]);
      const balances = new Map((cr ?? []).map((r) => [r.athlete_id, r.balance]));
      scheduleClientsForCoach = (cm ?? [])
        .map((m: any) => ({
          id: m.profile_id,
          fullName: m.profiles?.full_name ?? "Unknown",
          balance: balances.get(m.profile_id) ?? 0,
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    }

    return (
      <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
        {isActingAsOther && (
          <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
        )}
        {isCoach && !isActingAsOther && (
          <ScheduleClientPicker groupId={params.groupId} clients={scheduleClientsForCoach} />
        )}
        <header className="px-5 pt-8 pb-6 border-b border-steel/20">
          <h1 className="font-display font-bold text-4xl leading-none uppercase">Calendar</h1>
          <p className="font-body text-sm text-steel mt-2">
            {program
              ? "Your program doesn't have a start date set yet — ask your coach, and your training schedule will show up here."
              : "No program assigned yet — you'll see your training schedule here once your coach assigns one."}
          </p>
          {coachMembership && (
            <p className="font-body text-xs text-steel mt-3">
              Session credits available: <span className="text-chalk font-medium">{creditBalance}</span>
            </p>
          )}
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
                    <CancelBookingButton
                      bookingId={b.id}
                      rescheduleHref={`${basePath}/${dateKey(start)}?reschedule=${b.id}`}
                    />
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
                const isToday = isSameDayLocal(date, today);
                const cellClass = `bg-graphite min-h-[64px] p-1.5 flex flex-col ${
                  isToday ? "ring-1 ring-inset ring-rust" : ""
                }`;
                const dayNumber = (
                  <span className={`font-body text-[10px] ${isToday ? "text-rust font-bold" : "text-steel"}`}>
                    {date.getDate()}
                  </span>
                );

                if (hasAvailability) {
                  return (
                    <Link key={i} href={`${basePath}/${dateKey(date)}${rescheduleSuffix ? `?${rescheduleSuffix.slice(1)}` : ""}`} className={cellClass}>
                      {dayNumber}
                    </Link>
                  );
                }
                return (
                  <div key={i} className={cellClass}>
                    {dayNumber}
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

            <div className="mt-4 mx-5 divide-y divide-steel/15 border-y border-steel/15">
              {weekDays.map((date, i) => {
                const isToday = isSameDayLocal(date, today);
                const rowClass = `flex items-center gap-3 py-3 ${isToday ? "bg-surface/40" : ""}`;
                const rowInner = (
                  <div className={`w-11 shrink-0 text-center ${isToday ? "text-rust" : "text-steel"}`}>
                    <p className="font-body text-[10px] uppercase tracking-wide">{WEEKDAY_LABELS[i]}</p>
                    <p className="font-display font-bold text-lg leading-none">{date.getDate()}</p>
                  </div>
                );

                if (hasAvailability) {
                  return (
                    <Link key={i} href={`${basePath}/${dateKey(date)}${rescheduleSuffix ? `?${rescheduleSuffix.slice(1)}` : ""}`} className={rowClass}>
                      {rowInner}
                      <p className="font-body text-xs text-steel">See open sessions</p>
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

        <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const today = new Date();
  const view = searchParams.view === "week" ? "week" : "month";
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
  const leadingBlanks = firstOfMonth.getDay();

  // Week view is keyed off its own anchor date, independent of the month
  // grid's year/monthIndex — a visible week routinely spans a month
  // boundary, so it gets its own date range rather than reusing the
  // month's.
  const weekAnchor = parseDateParam(searchParams.week, today);
  const weekStart = new Date(weekAnchor);
  weekStart.setDate(weekAnchor.getDate() - weekAnchor.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const rangeStart = view === "week" ? weekStart : firstOfMonth;
  const rangeEnd = view === "week" ? weekEnd : new Date(year, monthIndex + 1, 1);

  // Every confirmed booking this coach has in the visible range, across
  // every client — the actual "what does my schedule look like" view,
  // distinct from Availability (which just configures the recurring
  // hours).
  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("id, start_at, athlete_id, profiles!bookings_athlete_id_fkey ( full_name )")
    .eq("coach_id", user.id)
    .eq("status", "confirmed")
    .gte("start_at", rangeStart.toISOString())
    .lt("start_at", rangeEnd.toISOString())
    .order("start_at", { ascending: true });

  const bookingsByDateKey = new Map<string, { time: string; name: string }[]>();
  for (const b of (bookingRows ?? []) as any[]) {
    const d = new Date(b.start_at);
    const key = dateKey(d);
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const name = b.profiles?.full_name ?? "A client";
    if (!bookingsByDateKey.has(key)) bookingsByDateKey.set(key, []);
    bookingsByDateKey.get(key)!.push({ time, name });
  }

  // Custom events + acted-on suggestions this coach has on the calendar
  // in the visible range — same coach-wide-not-group-scoped model as
  // bookings above.
  const { data: eventRows } = await supabase
    .from("calendar_events")
    .select("id, title, event_date, event_time, event_type, status")
    .eq("coach_id", user.id)
    .neq("status", "dismissed")
    .gte("event_date", dateKey(rangeStart))
    .lt("event_date", dateKey(rangeEnd))
    .order("event_time", { ascending: true });

  const eventsByDateKey = new Map<string, CalendarEventEntry[]>();
  for (const e of eventRows ?? []) {
    if (!eventsByDateKey.has(e.event_date)) eventsByDateKey.set(e.event_date, []);
    eventsByDateKey.get(e.event_date)!.push({
      id: e.id,
      title: e.title,
      time: e.event_time ? formatTimeString(e.event_time) : null,
      type: e.event_type as "custom" | "suggestion",
      status: e.status,
    });
  }

  // Quick-jump roster — each client's own habits/macros/workout-override
  // calendar lives on their profile, this is just a fast way in.
  const { data: memberships } = await supabase
    .from("group_memberships")
    .select("profile_id, profiles ( full_name, avatar_url )")
    .eq("group_id", params.groupId)
    .eq("role", "athlete");

  const clientIds = (memberships ?? []).map((m: any) => m.profile_id);
  const { data: creditRows } = await supabase
    .from("session_credits")
    .select("athlete_id, balance")
    .eq("group_id", params.groupId)
    .in("athlete_id", clientIds.length > 0 ? clientIds : [""]);

  const balanceByAthlete = new Map((creditRows ?? []).map((r) => [r.athlete_id, r.balance]));

  const clients = (memberships ?? [])
    .map((m: any) => ({
      profileId: m.profile_id,
      fullName: m.profiles?.full_name ?? "Unknown",
      balance: balanceByAthlete.get(m.profile_id) ?? 0,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  // Every active program in this group — shared and every client's
  // personal one — overlaid onto this same calendar so there's no
  // separate "view this program as a calendar" page to hunt down. A
  // program with no start_date/training_days set contributes nothing to
  // the grid but still surfaces below as something that needs attention.
  const { data: activePrograms } = await supabase
    .from("programs")
    .select("id, name, athlete_id, start_date, training_days")
    .eq("group_id", params.groupId)
    .eq("is_active", true);

  const athleteNameById = new Map(clients.map((c) => [c.profileId, c.fullName]));
  const workoutsByDateKey = new Map<string, { title: string; athleteName: string | null }[]>();
  const programsMissingSchedule: { id: string; name: string; athleteName: string | null }[] = [];
  const programsWithNoWorkouts: { id: string; name: string; athleteName: string | null }[] = [];

  for (const p of activePrograms ?? []) {
    const athleteName = p.athlete_id ? athleteNameById.get(p.athlete_id) ?? null : null;
    const { data: programWorkouts } = await supabase
      .from("workouts")
      .select("id, title, week_number, day_index")
      .eq("program_id", p.id)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true });

    if ((programWorkouts ?? []).length === 0) {
      programsWithNoWorkouts.push({ id: p.id, name: p.name, athleteName });
      continue;
    }

    if (!p.start_date || !p.training_days || p.training_days.length === 0) {
      programsMissingSchedule.push({ id: p.id, name: p.name, athleteName });
      continue;
    }

    const scheduledDateByDayId = computeScheduledDates(p.start_date, p.training_days, programWorkouts!);
    for (const w of programWorkouts!) {
      const d = scheduledDateByDayId.get(w.id);
      if (!d) continue;
      const k = dateKey(d);
      if (!workoutsByDateKey.has(k)) workoutsByDateKey.set(k, []);
      workoutsByDateKey.get(k)!.push({ title: w.title, athleteName });
    }
  }

  // Clients with no active program covering them at all (no shared active
  // program in this group, and no personal one either).
  const hasSharedActiveProgram = (activePrograms ?? []).some((p) => !p.athlete_id);
  const athleteIdsWithPersonalProgram = new Set(
    (activePrograms ?? []).filter((p) => p.athlete_id).map((p) => p.athlete_id)
  );
  const clientsWithNoProgram = hasSharedActiveProgram
    ? []
    : clients.filter((c) => !athleteIdsWithPersonalProgram.has(c.profileId));

  // Clients quiet 7+ days (or never logged) — same "needs attention" idea
  // already used on the Clients page, surfaced here too since this is the
  // coach's daily planning view.
  const { data: recentLogRows } = await supabase
    .from("workout_logs")
    .select("athlete_id, created_at")
    .eq("group_id", params.groupId)
    .order("created_at", { ascending: false });
  const lastLogByAthlete = new Map<string, string>();
  for (const log of recentLogRows ?? []) {
    if (!lastLogByAthlete.has(log.athlete_id)) lastLogByAthlete.set(log.athlete_id, log.created_at);
  }
  const quietClients = clients.filter((c) => {
    const last = lastLogByAthlete.get(c.profileId);
    if (!last) return true;
    const daysSince = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince >= 7;
  });

  const { data: coachProfile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const timezone = coachProfile?.timezone ?? DEFAULT_COACH_TIMEZONE;

  const { data: windowRows } = await supabase
    .from("coach_availability_windows")
    .select("id, weekday, start_time, end_time, slot_duration_minutes")
    .eq("coach_id", user.id)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  const availabilityWindows = (windowRows ?? []).map((w) => ({
    id: w.id,
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
  }));

  const { data: exceptionRows } = await supabase
    .from("coach_availability_exceptions")
    .select("kind, start_at, end_at, weekday, start_time, end_time")
    .eq("coach_id", user.id);
  const blockedRanges = (exceptionRows ?? []).map((e) => ({
    kind: e.kind as "one_off" | "recurring",
    startAt: e.start_at,
    endAt: e.end_at,
    weekday: e.weekday,
    startTime: e.start_time,
    endTime: e.end_time,
  }));

  const selectedClientId = searchParams.client;

  const cells: (Date | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, monthIndex, i + 1)),
  ];

  const prevMonth = new Date(year, monthIndex - 1, 1);
  const nextMonth = new Date(year, monthIndex + 1, 1);
  const basePath = `/groups/${params.groupId}/calendar`;
  const prevHref = `${basePath}?month=${prevMonth.getFullYear()}-${String(
    prevMonth.getMonth() + 1
  ).padStart(2, "0")}`;
  const nextHref = `${basePath}?month=${nextMonth.getFullYear()}-${String(
    nextMonth.getMonth() + 1
  ).padStart(2, "0")}`;

  const prevWeek = new Date(weekStart);
  prevWeek.setDate(weekStart.getDate() - 7);
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(weekStart.getDate() + 7);
  const prevWeekHref = `${basePath}?view=week&week=${dateKey(prevWeek)}`;
  const nextWeekHref = `${basePath}?view=week&week=${dateKey(nextWeek)}`;
  const monthViewHref = `${basePath}?month=${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const weekViewHref = `${basePath}?view=week&week=${dateKey(weekStart)}`;

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="calendar">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Calendar</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Every client&apos;s scheduled workouts and booked 1-on-1 sessions,
          overlaid on one calendar — set your recurring hours on the
          Availability tab below.
        </p>
      </div>

      <CalendarPageTabs coachId={user.id} initialWindows={availabilityWindows}>
      <div className="grid grid-cols-[1fr_260px] gap-8 items-start">
        <div>
          <div className="flex items-center gap-1 mb-4">
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

              <CalendarGrid
                groupId={params.groupId}
                selectedClientId={selectedClientId}
                headerLabels={WEEKDAY_LABELS}
                cellDates={cells}
                today={today}
                bookingsByDateKey={bookingsByDateKey}
                eventsByDateKey={eventsByDateKey}
                workoutsByDateKey={workoutsByDateKey}
                blockedRanges={blockedRanges}
                availabilityWindows={availabilityWindows}
                timezone={timezone}
                cellMinHeightPx={80}
                showAllBookings={false}
              />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
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

              <CalendarGrid
                groupId={params.groupId}
                selectedClientId={selectedClientId}
                headerLabels={weekDays.map((d, i) => `${WEEKDAY_LABELS[i]} ${d.getDate()}`)}
                cellDates={weekDays}
                today={today}
                bookingsByDateKey={bookingsByDateKey}
                eventsByDateKey={eventsByDateKey}
                workoutsByDateKey={workoutsByDateKey}
                blockedRanges={blockedRanges}
                availabilityWindows={availabilityWindows}
                timezone={timezone}
                cellMinHeightPx={300}
                showAllBookings
              />
            </>
          )}
        </div>

        <div>
          {(programsMissingSchedule.length > 0 ||
            programsWithNoWorkouts.length > 0 ||
            clientsWithNoProgram.length > 0 ||
            quietClients.length > 0) && (
            <div className="mb-6 border border-rust/30 bg-rust/5 p-3">
              <h2 className="font-display uppercase text-sm tracking-wide text-rust mb-2">
                Needs attention
              </h2>
              <div className="space-y-1.5">
                {programsWithNoWorkouts.map((p) => (
                  <Link
                    key={`empty-${p.id}`}
                    href={`/groups/${params.groupId}/programs/${p.id}`}
                    className="block font-body text-xs text-chalk active:text-rust"
                  >
                    &ldquo;{p.name}&rdquo;{p.athleteName ? ` (${p.athleteName})` : ""} has no
                    workouts built yet
                  </Link>
                ))}
                {programsMissingSchedule.map((p) => (
                  <Link
                    key={`sched-${p.id}`}
                    href={`/groups/${params.groupId}/programs/${p.id}`}
                    className="block font-body text-xs text-chalk active:text-rust"
                  >
                    &ldquo;{p.name}&rdquo;{p.athleteName ? ` (${p.athleteName})` : ""} needs a
                    start date to show on the calendar
                  </Link>
                ))}
                {clientsWithNoProgram.map((c) => (
                  <Link
                    key={`noprog-${c.profileId}`}
                    href={`/groups/${params.groupId}/athletes/${c.profileId}`}
                    className="block font-body text-xs text-chalk active:text-rust"
                  >
                    {c.fullName} has no program assigned
                  </Link>
                ))}
                {quietClients.map((c) => (
                  <Link
                    key={`quiet-${c.profileId}`}
                    href={`/groups/${params.groupId}/athletes/${c.profileId}`}
                    className="block font-body text-xs text-chalk active:text-rust"
                  >
                    {c.fullName} hasn&apos;t logged a workout in 7+ days
                  </Link>
                ))}
              </div>
            </div>
          )}

          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Clients
          </h2>
          <p className="font-body text-[11px] text-steel mb-2">
            Drag a name onto a day to book them, or click a name then click a
            date. Use +/- to quickly adjust session credits.
          </p>
          <CalendarClientList
            clients={clients}
            groupId={params.groupId}
            basePath={basePath}
            monthParam={monthParam}
            selectedClientId={selectedClientId}
          />
        </div>
      </div>
      </CalendarPageTabs>
    </CoachDesktopShell>
  );
}
