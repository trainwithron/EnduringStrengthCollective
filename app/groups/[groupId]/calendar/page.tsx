import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CalendarPageTabs } from "@/components/coach/desktop/calendar-page-tabs";
import { CalendarGrid, type CalendarEventEntry } from "@/components/coach/desktop/calendar-grid";
import { CalendarClientList } from "@/components/coach/desktop/calendar-client-list";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { isPwaStandalone } from "@/lib/pwa-server";

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

export default async function CoachCalendarPage({
  params,
  searchParams,
}: {
  params: { groupId: string };
  searchParams: { month?: string; client?: string; view?: string; week?: string };
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

  const isCoach = membership?.role === "coach";
  // A coach opening the installed home-screen app gets the same
  // athlete-style calendar a client gets — logging their own training
  // doesn't need the full booking/scheduling dashboard built for running
  // a business. The same coach in a plain browser tab still gets the
  // full desktop calendar below.
  const showMobileView = !isCoach || isPwaStandalone();

  if (showMobileView) {
    const { data: program } = await supabase
      .from("programs")
      .select("id")
      .eq("group_id", params.groupId)
      .eq("is_active", true)
      .maybeSingle();

    if (program) {
      redirect(`/groups/${params.groupId}/programs/${program.id}/calendar`);
    }

    return (
      <main className="min-h-screen bg-graphite text-chalk font-body pb-24 flex items-center justify-center px-6">
        <p className="font-body text-steel text-center max-w-[40ch]">
          No active program yet, or it isn&apos;t scheduled — check with your coach.
        </p>
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
          Your booked 1-on-1 sessions across every client this month — set
          your recurring hours on the Availability tab below.
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
                availabilityWindows={availabilityWindows}
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
                availabilityWindows={availabilityWindows}
                cellMinHeightPx={300}
                showAllBookings
              />
            </>
          )}
        </div>

        <div>
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
