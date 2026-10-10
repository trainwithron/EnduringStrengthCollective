import { fetchSessionMinutes, sessionMinutesFor } from "@/lib/availability-windows";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { CalendarPageTabs } from "@/components/coach/desktop/calendar-page-tabs";
import { CalendarGrid, type CalendarEventEntry } from "@/components/coach/desktop/calendar-grid";
import { CalendarClientRail } from "@/components/coach/desktop/calendar-client-rail";
import { CalendarAttentionChip } from "@/components/coach/desktop/calendar-attention-chip";
import { CalendarSchedulingProvider } from "@/components/coach/desktop/calendar-scheduling-context";
import { buildAttentionItems } from "@/lib/calendar-attention";
import { dateFromKey, monthCellKeys, weekKeys } from "@/lib/date-key";
import { chunk } from "@/lib/chunk";
import { pageAll } from "@/lib/page-all";
import { fetchInactiveKeys, inactiveKey } from "@/lib/inactive-ids";
import { defaultSessionTypeId, lastTypeByClient, type ClientTierLite } from "@/lib/session-type-default";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { CoachMobileShell } from "@/components/coach/mobile/coach-mobile-shell";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { computeScheduledDates } from "@/lib/program-schedule";
import { ScheduleClientPicker } from "@/components/coach/schedule-client-picker";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone } from "@/lib/timezone";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { getCoachClients } from "@/lib/coach-clients";
import { coachCreditSentence } from "@/lib/credit-sentence";
import { formatSlotTime } from "@/lib/booking-slots";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { getCoachedGroups } from "@/lib/coach-groups";
import { AddGroupEvent } from "@/components/coach/add-group-event";
import { UpcomingGroupEvents } from "@/components/group/group-event-answer";
import { computeQuietTier } from "@/lib/quiet-client-tier";
import { gatherCalendarSpotterFindings } from "@/lib/calendar-spotter-gather";
import { CalendarSpotterPanel } from "@/components/coach/desktop/calendar-spotter-panel";
import { gatherSchedulingSpotterFlags } from "@/lib/calendar-spotter-phase2-gather";
import { SchedulingSpotterPanel } from "@/components/coach/desktop/scheduling-spotter-panel";
import { NO_SESSIONS_LINE } from "@/lib/session-credit-copy";
import { buildCreditPicture, clientCreditPictureLine, fetchBookingCounts } from "@/lib/credit-picture";

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

// The coach's calendar. Two routes show it: /calendar (the coach-level one, no group in the address, organization-only top bar) and, for a client or a phone, /groups/<id>/calendar.
export async function CoachCalendarPageBody(
  props: {
    coachLevel?: boolean;
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{
      month?: string;
      client?: string;
      view?: string;
      week?: string;
      reschedule?: string;
      scheduleFor?: string;
      tab?: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const coachLevel = props.coachLevel ?? false;
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
    // Every client across the coach's groups (a one-on-one client lives in their own group), each with their own group so the booking
    // and the balance are the ones kept for that client.
    const [coachClients, { data: coachGroup }, { data: coachProfileRow }] = await Promise.all([
      getCoachClients(supabase, user.id, params.groupId),
      supabase.from("groups").select("name").eq("id", params.groupId).maybeSingle(),
      supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    ]);
    const coachGroupName = coachGroup?.name ?? "Coaching";
    const coachTz = coachProfileRow?.timezone ?? DEFAULT_COACH_TIMEZONE;

    const clientIds = coachClients.map((c) => c.id);
    const creditRows = (
      await Promise.all(chunk(clientIds, 100).map((ids) => supabase.from("session_credits").select("athlete_id, group_id, balance").in("athlete_id", ids)))
    ).flatMap((r) => r.data ?? []);
    const balanceByClientGroup = new Map((creditRows ?? []).map((r) => [`${r.athlete_id}:${r.group_id}`, r.balance as number]));

    const phoneCounts = await fetchBookingCounts(supabase, { coachId: user.id });
    const scheduleClients = coachClients.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      groupId: c.groupId,
      balance: balanceByClientGroup.get(`${c.id}:${c.groupId}`) ?? 0,
      booked: phoneCounts.get(`${c.id}:${c.groupId}`)?.booked ?? 0,
    }));

    if (!searchParams.scheduleFor) {
      // No client picked yet — this is the coach's own real destination
      // for the Calendar tab (coach_mobile_app_redesign_plan.md); falling
      // through to the athlete booking-calendar rendering further below
      // would show a real client an "assign yourself a program" empty
      // state that makes no sense for the coach viewing it.
      //
      // Real, live-confirmed gap: before a client is picked, this screen
      // was just the dropdown + one line of helper text, then hundreds of
      // pixels of dead space above the bottom nav. Same real data this
      // page's own rail widget (calendar-rail-widget.tsx) already queries
      // for "Today" — widened to the next 5 days and no longer date-
      // gated — so the coach sees their real upcoming schedule across
      // every client while deciding who to book, instead of a void.
      const upcomingRangeEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const { data: upcomingBookingRows } = await supabase
        .from("bookings")
        .select("id, start_at, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("status", "confirmed")
        .gte("start_at", new Date().toISOString())
        .lt("start_at", upcomingRangeEnd.toISOString())
        .order("start_at", { ascending: true })
        .limit(10);
      const upcomingBookings = (upcomingBookingRows ?? []).map((b: any) => ({
        id: b.id,
        startAt: b.start_at as string,
        athleteName: b.profiles?.full_name ?? "Client",
      }));

      // The general calendar: this month, every client's sessions on their day (on the coach's clock). It is what the Calendar tab
      // always opens; one client is chosen afterwards, never first.
      const generalToday = new Date();
      const generalMonthMatch = /^(\d{4})-(\d{2})$/.exec(searchParams.month ?? "");
      const gYear = generalMonthMatch ? Number(generalMonthMatch[1]) : generalToday.getFullYear();
      const gMonthIndex = generalMonthMatch ? Math.min(11, Math.max(0, Number(generalMonthMatch[2]) - 1)) : generalToday.getMonth();
      const gPrev = new Date(gYear, gMonthIndex - 1, 1);
      const gNext = new Date(gYear, gMonthIndex + 1, 1);
      const gKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const gMonthStart = new Date(gYear, gMonthIndex, 1, 0, 0, 0);
      const gMonthEnd = new Date(gYear, gMonthIndex + 1, 1, 0, 0, 0);
      const { data: monthBookingRows } = await supabase
        .from("bookings")
        .select("id, start_at, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("status", "confirmed")
        .gte("start_at", new Date(gMonthStart.getTime() - 86400000).toISOString())
        .lt("start_at", new Date(gMonthEnd.getTime() + 86400000).toISOString())
        .order("start_at", { ascending: true });
      const sessionsByGeneralDay = new Map<string, { time: string; name: string }[]>();
      for (const b of (monthBookingRows ?? []) as any[]) {
        const k = dateKeyInZone(coachTz, new Date(b.start_at));
        const list = sessionsByGeneralDay.get(k) ?? [];
        list.push({ time: formatInTimezone(new Date(b.start_at), coachTz, "time"), name: String(b.profiles?.full_name ?? "Client").split(" ")[0] });
        sessionsByGeneralDay.set(k, list);
      }
      const gLeading = new Date(gYear, gMonthIndex, 1).getDay();
      const gDays = new Date(gYear, gMonthIndex + 1, 0).getDate();
      const gCells: (Date | null)[] = [
        ...Array.from({ length: gLeading }, () => null),
        ...Array.from({ length: gDays }, (_, i) => new Date(gYear, gMonthIndex, i + 1)),
      ];
      const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

      return (
        <main className="min-h-screen bg-graphite text-chalk font-body">
          <CoachMobileShell groupId={params.groupId} groupName={coachGroupName} activeOverride="calendar">
            <header className="px-5 pt-8 pb-4">
              <h1 className="font-display font-bold text-3xl leading-none uppercase">Calendar</h1>
            </header>
            <div className="px-5 pb-24">
              <ScheduleClientPicker groupId={params.groupId} clients={scheduleClients} />
              <div className="flex items-center justify-between mt-3">
                <Link
                  href={`/groups/${params.groupId}/calendar?month=${gKey(gPrev)}`}
                  className="h-11 px-3 inline-flex items-center font-body text-sm text-chalk underline underline-offset-2"
                >
                  &larr; {gPrev.toLocaleDateString("en-US", { month: "short" })}
                </Link>
                <span className="font-display font-bold uppercase text-base">{monthLabel(gYear, gMonthIndex)}</span>
                <Link
                  href={`/groups/${params.groupId}/calendar?month=${gKey(gNext)}`}
                  className="h-11 px-3 inline-flex items-center font-body text-sm text-chalk underline underline-offset-2"
                >
                  {gNext.toLocaleDateString("en-US", { month: "short" })} &rarr;
                </Link>
              </div>
              <p className="font-body text-xs text-steel mt-1">All clients. Tap a day to see its sessions and open times.</p>
              <div className="grid grid-cols-7 gap-px bg-steel/15 mt-3 border border-steel/15">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="bg-graphite text-center font-body text-xs text-steel uppercase tracking-wide py-1.5">
                    {label}
                  </div>
                ))}
                {gCells.map((date, i) => {
                  if (!date) return <div key={i} className="bg-graphite min-h-[56px]" />;
                  const isToday = sameDay(date, generalToday);
                  const sessions = sessionsByGeneralDay.get(dateKey(date)) ?? [];
                  return (
                    <Link
                      key={i}
                      href={`/groups/${params.groupId}/calendar/${dateKey(date)}`}
                      className={`bg-graphite min-h-[56px] p-1.5 flex flex-col ${isToday ? "ring-1 ring-inset ring-rust" : ""}`}
                    >
                      <span className={`font-body text-xs ${isToday ? "text-rust font-bold" : "text-steel"}`}>{date.getDate()}</span>
                      {sessions.slice(0, 2).map((s, idx) => (
                        <span key={idx} className="font-body text-[10px] leading-tight text-chalk mt-0.5 truncate">
                          {s.time} {s.name}
                        </span>
                      ))}
                      {sessions.length > 2 && (
                        <span className="font-body text-[10px] leading-tight text-rust mt-0.5">+{sessions.length - 2}</span>
                      )}
                    </Link>
                  );
                })}
              </div>

              <h2 className="font-body text-xs text-steel uppercase tracking-wide mt-8 mb-2">
                Upcoming sessions
              </h2>
              {upcomingBookings.length === 0 ? (
                <p className="font-body text-sm text-steel">Nothing booked in the next 5 days.</p>
              ) : (
                <div className="divide-y divide-steel/15 border-t border-steel/15">
                  {upcomingBookings.map((b) => (
                    <div key={b.id} className="py-2.5 flex items-center justify-between gap-3">
                      <span className="font-body text-sm">{b.athleteName}</span>
                      <span className="font-body text-xs text-steel shrink-0">
                        {formatInTimezone(new Date(b.startAt), coachTz, "dateTime")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CoachMobileShell>
        </main>
      );
    }

    const selected = scheduleClients.find((c) => c.id === searchParams.scheduleFor);
    // The client is booked in THEIR group (sessions and balances are kept per group), so move to it if we are standing in another.
    if (selected && selected.groupId !== params.groupId) {
      redirect(`/groups/${selected.groupId}/calendar?scheduleFor=${selected.id}${searchParams.month ? `&month=${searchParams.month}` : ""}`);
    }
    if (!selected) {
      return (
        <main className="min-h-screen bg-graphite text-chalk font-body">
          <CoachMobileShell groupId={params.groupId} groupName={coachGroupName} activeOverride="calendar">
            <div className="px-5 pt-8 pb-24">
              <ScheduleClientPicker groupId={params.groupId} clients={scheduleClients} />
              <p className="font-body text-sm text-steel pt-6">Client not found.</p>
            </div>
          </CoachMobileShell>
        </main>
      );
    }

    const today = new Date();
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(searchParams.month ?? "");
    const year = monthMatch ? Number(monthMatch[1]) : today.getFullYear();
    const monthIndex = monthMatch ? Math.min(11, Math.max(0, Number(monthMatch[2]) - 1)) : today.getMonth();
    const prevMonth = new Date(year, monthIndex - 1, 1);
    const nextMonth = new Date(year, monthIndex + 1, 1);
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const monthHref = (d: Date) => `/groups/${params.groupId}/calendar?scheduleFor=${selected.id}&month=${monthKey(d)}`;
    const firstOfMonth = new Date(year, monthIndex, 1);

    // This client's confirmed sessions in the visible month, shown on their day (on the coach's clock).
    const monthStart = new Date(year, monthIndex, 1, 0, 0, 0);
    const monthEnd = new Date(year, monthIndex + 1, 1, 0, 0, 0);
    const { data: clientMonthBookings } = await supabase
      .from("bookings")
      .select("id, start_at")
      .eq("coach_id", user.id)
      .eq("athlete_id", selected.id)
      .eq("group_id", params.groupId)
      .eq("status", "confirmed")
      .gte("start_at", new Date(monthStart.getTime() - 86400000).toISOString())
      .lt("start_at", new Date(monthEnd.getTime() + 86400000).toISOString());
    const sessionsByDay = new Map<string, string[]>();
    for (const b of clientMonthBookings ?? []) {
      const k = dateKeyInZone(coachTz, new Date(b.start_at));
      const list = sessionsByDay.get(k) ?? [];
      list.push(formatInTimezone(new Date(b.start_at), coachTz, "time"));
      sessionsByDay.set(k, list);
    }
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
      <main className="min-h-screen bg-graphite text-chalk font-body">
        <CoachMobileShell groupId={params.groupId} groupName={coachGroupName} activeOverride="calendar">
          <div className="pb-24">
            <ScheduleClientPicker groupId={params.groupId} clients={scheduleClients} selectedId={selected.id} />
            <div className="px-5 pt-4">
              <p className="font-body text-sm text-chalk">
                <span className="text-steel">{coachCreditSentence(buildCreditPicture({ balance: selected.balance, booked: selected.booked ?? 0, toMark: 0 }), selected.fullName)}</span>
              </p>
              <p className="font-body text-xs text-steel mt-1">Tap a date to see and book open sessions.</p>
              <div className="flex items-center justify-between mt-3">
                <Link href={monthHref(prevMonth)} className="h-11 px-3 inline-flex items-center font-body text-sm text-chalk underline underline-offset-2">
                  &larr; {prevMonth.toLocaleDateString("en-US", { month: "short" })}
                </Link>
                <span className="font-display font-bold uppercase text-base">{monthLabel(year, monthIndex)}</span>
                <Link href={monthHref(nextMonth)} className="h-11 px-3 inline-flex items-center font-body text-sm text-chalk underline underline-offset-2">
                  {nextMonth.toLocaleDateString("en-US", { month: "short" })} &rarr;
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-px bg-steel/15 mt-4 mx-5 border border-steel/15">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="bg-graphite text-center font-body text-xs text-steel uppercase tracking-wide py-1.5"
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
                    <span className={`font-body text-xs ${isToday ? "text-rust font-bold" : "text-steel"}`}>
                      {date.getDate()}
                    </span>
                    {(sessionsByDay.get(dateKey(date)) ?? []).slice(0, 2).map((t, idx) => (
                      <span key={idx} className="font-body text-[10px] leading-tight text-chalk mt-0.5 truncate">
                        {t}
                      </span>
                    ))}
                  </Link>
                );
              })}
            </div>
          </div>
        </CoachMobileShell>
      </main>
    );
  }

  if (showMobileView) {
    // A personal program assigned to this athlete wins over the group's
    // shared one — same precedence as lib/todays-workout.ts. Two queries,
    // not one `athlete_id = X or athlete_id is null` filter, since both
    // could be simultaneously active and .maybeSingle() would error on
    // more than one row.
    // Both queries run unconditionally in parallel rather than fetching
    // shared only when personal comes back empty — at most one extra,
    // cheap row fetched in the common case, but it removes a real
    // sequential round trip from every athlete's calendar load.
    const [{ data: personalProgram }, { data: sharedProgramRaw }] = await Promise.all([
      supabase
        .from("programs")
        .select("id, start_date, training_days")
        .eq("group_id", params.groupId)
        .eq("athlete_id", athleteId)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("programs")
        .select("id, start_date, training_days")
        .eq("group_id", params.groupId)
        .is("athlete_id", null)
        .eq("is_active", true)
        .maybeSingle(),
    ]);
    const sharedProgram = personalProgram ? null : sharedProgramRaw;

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
    // creditsRow only needs athleteId/groupId — genuinely independent of
    // coachMembership, so it runs alongside it instead of after. Its
    // display is already gated on `coachMembership` truthy at render
    // time, so computing it regardless changes nothing visible.
    const [{ data: coachMembership }, { data: creditsRow }] = await Promise.all([
      supabase
        .from("group_memberships")
        .select("profile_id")
        .eq("group_id", params.groupId)
        .eq("role", "coach")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("session_credits")
        .select("balance")
        .eq("athlete_id", athleteId)
        .eq("group_id", params.groupId)
        .maybeSingle(),
    ]);
    const creditBalance = creditsRow?.balance ?? 0;
    const creditBooked = (await fetchBookingCounts(supabase, { athleteId, groupId: params.groupId })).get(`${athleteId}:${params.groupId}`)?.booked ?? 0;

    let hasAvailability = false;
    let upcomingBookings: { id: string; start_at: string }[] = [];
    let displayTz = DEFAULT_COACH_TIMEZONE;

    if (coachMembership) {
      const [{ count }, { data: tzRow }] = await Promise.all([
        supabase
          .from("coach_availability_windows")
          .select("id", { count: "exact", head: true })
          .eq("coach_id", coachMembership.profile_id),
        supabase.from("profiles").select("timezone").eq("id", coachMembership.profile_id).maybeSingle(),
      ]);
      hasAvailability = (count ?? 0) > 0;
      displayTz = tzRow?.timezone ?? DEFAULT_COACH_TIMEZONE;
    }

    // A client's own sessions show whether or not the coach has set up open hours (the coach can book anyone at any time), and
    // whichever coach booked them: the list is this client's, in this group.
    {
      const { data: bookingRows } = await supabase
        .from("bookings")
        .select("id, start_at")
        .eq("athlete_id", athleteId)
        .eq("group_id", params.groupId)
        .eq("status", "confirmed")
        .gte("start_at", new Date().toISOString())
        .order("start_at", { ascending: true });
      upcomingBookings = bookingRows ?? [];
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
              {clientCreditPictureLine(buildCreditPicture({ balance: creditBalance, booked: creditBooked, toMark: 0 }), NO_SESSIONS_LINE)}
            </p>
          )}
        </header>

        <UpcomingGroupEvents athleteId={athleteId} timezone={displayTz} />

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
                      {formatInTimezone(start, displayTz, "dateTime")}
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
                  className="bg-graphite text-center font-body text-xs text-steel uppercase tracking-wide py-1.5"
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
                  <span className={`font-body text-xs ${isToday ? "text-rust font-bold" : "text-steel"}`}>
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
                    <p className="font-body text-xs uppercase tracking-wide">{WEEKDAY_LABELS[i]}</p>
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
    .select("name, organization_id")
    .eq("id", params.groupId)
    .single();

  // "Today" is the coach's today (the server runs in UTC: on a Saturday or Sunday evening in Pacific time it would already be next week).
  const { data: earlyTzRow } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
  const today = dateFromKey(dateKeyInZone((earlyTzRow?.timezone as string | null) ?? DEFAULT_COACH_TIMEZONE));
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

  // Every one of these 8 queries is independent of the others — none
  // reads a result another produces — so they run as one batch instead
  // of 8 sequential round trips. This is the real fix for this page's
  // measured multi-second load: each round trip pays a real network
  // cost, and this page had grown to pay it 8+ times in a row.
  const [
    { data: bookingRows },
    { data: eventRows },
    { data: memberships },
    { data: activePrograms },
    { data: recentLogRows },
    { data: coachProfile },
    { data: windowRows },
    { data: exceptionRows },
  ] = await Promise.all([
    // Every confirmed booking this coach has in the visible range,
    // across every client — the actual "what does my schedule look
    // like" view, distinct from Availability (which just configures
    // the recurring hours).
    supabase
      .from("bookings")
      .select("id, start_at, end_at, athlete_id, profiles!bookings_athlete_id_fkey ( full_name )")
      .eq("coach_id", user.id)
      .eq("status", "confirmed")
      // Padded by a day and a half each side: the grid's cells are the coach's days, the server's midnights are UTC, and a Pacific evening session on the
      // last day of a month would otherwise fall past the end of the range and appear on no month at all. The cell keys decide where each one shows.
      .gte("start_at", new Date(rangeStart.getTime() - 36 * 3600000).toISOString())
      .lt("start_at", new Date(rangeEnd.getTime() + 36 * 3600000).toISOString())
      .order("start_at", { ascending: true }),
    // Custom events + acted-on suggestions this coach has on the
    // calendar in the visible range — same coach-wide-not-group-scoped
    // model as bookings above.
    supabase
      .from("calendar_events")
      .select("id, title, event_date, event_time, event_type, status")
      .eq("coach_id", user.id)
      .neq("status", "dismissed")
      .gte("event_date", dateKey(rangeStart))
      .lt("event_date", dateKey(rangeEnd))
      .order("event_time", { ascending: true }),
    // Quick-jump roster — each client's own habits/macros/workout-
    // override calendar lives on their profile, this is just a fast
    // way in.
    supabase
      .from("group_memberships")
      .select("profile_id, profiles ( full_name, avatar_url )")
      .eq("group_id", params.groupId)
      .eq("role", "athlete"),
    // Every active program in this group — shared and every client's
    // personal one — overlaid onto this same calendar so there's no
    // separate "view this program as a calendar" page to hunt down.
    supabase
      .from("programs")
      .select("id, name, athlete_id, start_date, training_days")
      .eq("group_id", params.groupId)
      .eq("is_active", true),
    // Clients quiet 7+ days (or never logged) — same "needs attention"
    // idea already used on the Clients page, surfaced here too since
    // this is the coach's daily planning view.
    supabase
      .from("workout_logs")
      .select("athlete_id, created_at")
      .eq("group_id", params.groupId)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    supabase
      .from("coach_availability_windows")
      .select("id, weekday, start_time, end_time, slot_duration_minutes")
      .eq("coach_id", user.id)
      .order("weekday", { ascending: true })
      .order("start_time", { ascending: true }),
    supabase
      .from("coach_availability_exceptions")
      .select("kind, start_at, end_at, weekday, start_time, end_time")
      .eq("coach_id", user.id),
  ]);

  // Dates and times on the COACH's clock. This page renders on the server, which runs in UTC: without the zone an evening session lands on
  // tomorrow's cell and a 6:00 AM one reads 1:00 PM.
  const bookingTz = coachProfile?.timezone ?? DEFAULT_COACH_TIMEZONE;
  // Group items on the coach's calendar: every group event (labelled with its group's name) and every small-group class. Each one holds the coach's time with a hidden
  // booking of the coach's own; that stand-in is left out below so the item shows once, under its real name.
  const { data: groupItemRows } = await supabase
    .from("group_sessions")
    .select("id, title, start_at, end_at, kind, group_id, anchor_booking_id")
    .eq("coach_id", user.id)
    .eq("status", "scheduled")
    .gte("start_at", new Date(rangeStart.getTime() - 36 * 3600000).toISOString())
    .lt("start_at", new Date(rangeEnd.getTime() + 36 * 3600000).toISOString());
  const groupItems = (groupItemRows ?? []) as { id: string; title: string; start_at: string; end_at: string; kind: string; group_id: string | null; anchor_booking_id: string | null }[];
  const anchorIds = new Set(groupItems.map((g) => g.anchor_booking_id).filter((x): x is string => !!x));
  const itemGroupIds = Array.from(new Set(groupItems.map((g) => g.group_id).filter((x): x is string => !!x)));
  const { data: itemGroupRows } = itemGroupIds.length ? await supabase.from("groups").select("id, name").in("id", itemGroupIds) : { data: [] as { id: string; name: string }[] };
  const itemGroupName = new Map((itemGroupRows ?? []).map((g) => [g.id, g.name as string]));

  const bookingsByDateKey = new Map<string, { time: string; name: string; startMs?: number; endMs?: number }[]>();
  for (const g of groupItems) {
    const d = new Date(g.start_at);
    const key = dateKeyInZone(bookingTz, d);
    const label = g.kind === "event" ? `${itemGroupName.get(g.group_id ?? "") ?? "Group"}: ${g.title}` : `Group session: ${g.title}`;
    if (!bookingsByDateKey.has(key)) bookingsByDateKey.set(key, []);
    bookingsByDateKey.get(key)!.push({ time: formatSlotTime(d, bookingTz), name: label, startMs: d.getTime(), endMs: new Date(g.end_at).getTime() });
  }
  for (const b of (bookingRows ?? []) as any[]) {
    if (anchorIds.has(b.id)) continue;
    const d = new Date(b.start_at);
    const key = dateKeyInZone(bookingTz, d);
    const time = formatSlotTime(d, bookingTz);
    const name = b.profiles?.full_name ?? "A client";
    if (!bookingsByDateKey.has(key)) bookingsByDateKey.set(key, []);
    bookingsByDateKey.get(key)!.push({ time, name, startMs: d.getTime(), endMs: b.end_at ? new Date(b.end_at).getTime() : undefined });
  }

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

  // Every client across the coach's groups, each with their own group (a one-on-one client lives in their own group).
  const coachClients = await getCoachClients(supabase, user.id, params.groupId);
  const clientIds = coachClients.map((c) => c.id);
  const creditRows = (
    await Promise.all(chunk(clientIds, 100).map((ids) => supabase.from("session_credits").select("athlete_id, group_id, balance").in("athlete_id", ids)))
  ).flatMap((r) => r.data ?? []);

  const balanceByClientGroup = new Map((creditRows ?? []).map((r) => [`${r.athlete_id}:${r.group_id}`, r.balance as number]));

  // Sessions the coach scheduled that have not happened yet (confirmed, not yet settled): they take a session when they do, so each client shows
  // "2 left, 1 pending". A client's own workouts never appear here: they cost nothing.
  const bookingCounts = await fetchBookingCounts(supabase, { coachId: user.id });

  const clients = coachClients.map((c) => ({
    profileId: c.id,
    fullName: c.fullName,
    groupId: c.groupId,
    balance: balanceByClientGroup.get(`${c.id}:${c.groupId}`) ?? 0,
    booked: bookingCounts.get(`${c.id}:${c.groupId}`)?.booked ?? 0,
    toMark: bookingCounts.get(`${c.id}:${c.groupId}`)?.toMark ?? 0,
  }));

  // Who the coach has set aside (left out of the flags and hidden in the list until asked for), and what the app knows about each client's start: when they
  // joined, whether they have signed in, and their tier (for their usual session type).
  const clientGroupIds = Array.from(new Set(clients.map((c) => c.groupId)));
  const setAsideKeySet = await fetchInactiveKeys(supabase, clientGroupIds);
  const clientMembershipRows = (
    await Promise.all(
      chunk(clientIds, 100).map((ids) =>
        supabase
          .from("group_memberships")
          .select("profile_id, group_id, joined_at, client_tier, profiles ( claimed_at )")
          .in("profile_id", ids)
          .in("group_id", clientGroupIds.length > 0 ? clientGroupIds : [""])
          .eq("role", "athlete")
      )
    )
  ).flatMap((r) => r.data ?? []);
  const membershipByClient = new Map(
    ((clientMembershipRows ?? []) as any[]).map((m) => [
      `${m.group_id}:${m.profile_id}`,
      { joinedAt: (m.joined_at as string | null) ?? null, tier: (m.client_tier as ClientTierLite) ?? null, signedIn: !!m.profiles?.claimed_at },
    ])
  );
  const athleteNameById = new Map(clients.map((c) => [c.profileId, c.fullName]));
  const workoutsByDateKey = new Map<string, { title: string; athleteName: string | null }[]>();
  const programsMissingSchedule: { id: string; name: string; athleteName: string | null }[] = [];
  const programsWithNoWorkouts: { id: string; name: string; athleteName: string | null }[] = [];

  // Real N+1 fixed: this used to fire one "workouts" query per active
  // program, sequentially, inside the loop below — a group with a dozen
  // active programs paid a dozen extra round trips on every calendar
  // load. One batched query covers every program's workouts at once.
  const activeProgramIds = (activePrograms ?? []).map((p) => p.id);
  const { data: allProgramWorkouts } = activeProgramIds.length
    ? await supabase
        .from("workouts")
        .select("id, title, week_number, day_index, program_id, scheduled_date")
        .in("program_id", activeProgramIds)
        .order("week_number", { ascending: true })
        .order("day_index", { ascending: true })
    : {
        data: [] as {
          id: string;
          title: string;
          week_number: number;
          day_index: number;
          program_id: string;
          scheduled_date: string | null;
        }[],
      };
  const workoutsByProgramId = new Map<string, typeof allProgramWorkouts>();
  for (const w of allProgramWorkouts ?? []) {
    const list = workoutsByProgramId.get(w.program_id) ?? [];
    list.push(w);
    workoutsByProgramId.set(w.program_id, list);
  }

  for (const p of activePrograms ?? []) {
    const athleteName = p.athlete_id ? athleteNameById.get(p.athlete_id) ?? null : null;
    const programWorkouts = workoutsByProgramId.get(p.id) ?? [];

    if (programWorkouts.length === 0) {
      programsWithNoWorkouts.push({ id: p.id, name: p.name, athleteName });
      continue;
    }

    if (!p.start_date || !p.training_days || p.training_days.length === 0) {
      programsMissingSchedule.push({ id: p.id, name: p.name, athleteName });
      continue;
    }

    const scheduledDateByDayId = computeScheduledDates(
      p.start_date,
      p.training_days,
      programWorkouts.map((w) => ({ id: w.id, scheduledDate: w.scheduled_date }))
    );
    for (const w of programWorkouts) {
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

  const lastLogByAthlete = new Map<string, string>();
  for (const log of recentLogRows ?? []) {
    if (!lastLogByAthlete.has(log.athlete_id)) lastLogByAthlete.set(log.athlete_id, log.created_at);
  }
  // A session the coach marked attended counts as activity too: a client trained in person with the coach is not "quiet" just because nothing was logged in the app.
  const attendedSessions = await pageAll(
    (from, to) =>
      supabase
        .from("bookings")
        .select("id, athlete_id, start_at")
        .eq("coach_id", user.id)
        .not("attended_at", "is", null)
        .order("start_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    { maxPages: 3 }
  );
  for (const s of attendedSessions.rows as { athlete_id: string; start_at: string }[]) {
    const seen = lastLogByAthlete.get(s.athlete_id);
    if (!seen || s.start_at > seen) lastLogByAthlete.set(s.athlete_id, s.start_at);
  }
  // Same frequency-normalized computeQuietTier used by the Dashboard hero
  // and the Client Profile banner — this box used to flag "quiet" off a
  // flat 7-calendar-day rule of its own, which could disagree with the
  // real, per-athlete-schedule verdict shown everywhere else in the app.
  const sharedActiveTrainingDays =
    (activePrograms ?? []).find((p) => !p.athlete_id)?.training_days ?? null;
  const personalTrainingDaysByAthlete = new Map<string, number[] | null>(
    (activePrograms ?? []).filter((p) => p.athlete_id).map((p) => [p.athlete_id as string, p.training_days])
  );
  const nowForQuietTier = new Date();
  const quietClients = clients
    .filter((c) => !setAsideKeySet.has(inactiveKey(c.groupId, c.profileId)))
    .map((c) => {
      const last = lastLogByAthlete.get(c.profileId);
      const trainingDays = personalTrainingDaysByAthlete.get(c.profileId) ?? sharedActiveTrainingDays;
      const member = membershipByClient.get(`${c.groupId}:${c.profileId}`);
      // The same new-client rule as Home: not flagged within 14 days of being added (45 if they have not signed in yet).
      const tier = computeQuietTier({
        lastLoggedAt: last ? new Date(last) : null,
        now: nowForQuietTier,
        addedAt: member?.joinedAt ? new Date(member.joinedAt) : null,
        signedIn: member?.signedIn,
        trainingDays,
      });
      return { ...c, tier, neverLogged: !last };
    })
    .filter((c) => c.tier !== "none");
  const attentionItems = buildAttentionItems({
    groupId: params.groupId,
    programsWithNoWorkouts,
    programsMissingSchedule: [],
    clientsWithNoProgram: clientsWithNoProgram.filter((c) => !setAsideKeySet.has(inactiveKey(c.groupId, c.profileId))),
    quietClients: quietClients.map((c) => ({ profileId: c.profileId, fullName: c.fullName, groupId: c.groupId, tier: c.tier as "mild" | "strong", neverLogged: c.neverLogged })),
  });

  // The groups a coach can add an event to (team and social groups; a one-on-one client's space is not a group event).
  const eventGroups = (await getCoachedGroups(supabase, user.id)).filter((g) => g.kind !== "one_on_one").map((g) => ({ id: g.id, name: g.name }));

  const calendarSpotterFindings = await gatherCalendarSpotterFindings(supabase, { groupId: params.groupId, coachId: user.id });
  const schedulingSpotterFlags = await gatherSchedulingSpotterFlags(supabase, {
    coachId: user.id,
    organizationId: group?.organization_id ?? null,
  });

  const timezone = coachProfile?.timezone ?? DEFAULT_COACH_TIMEZONE;

  const sessionIndex = await fetchSessionMinutes(supabase, [user.id]);
  // The Availability tab shows the same three numbers (slot step, session length, gap) as the Availability page; each hides itself until its database column exists.
  const sessionProbe = await supabase.from("coach_availability_windows").select("session_minutes").eq("coach_id", user.id).limit(1);
  const { data: gapPolicy } = await supabase.from("coach_booking_policies").select("buffer_minutes").eq("coach_id", user.id).maybeSingle();
  const availabilityWindows = (windowRows ?? []).map((w) => ({
    id: w.id,
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
    sessionMinutes: sessionMinutesFor(sessionIndex, user.id, w) ?? null,
  }));

  const blockedRanges = (exceptionRows ?? []).map((e) => ({
    kind: e.kind as "one_off" | "recurring",
    startAt: e.start_at,
    endAt: e.end_at,
    weekday: e.weekday,
    startTime: e.start_time,
    endTime: e.end_time,
  }));

  // Session types (Online, In person...) and each client's usual one: the type of their latest typed session, else the one type that fits their tier.
  const { data: typeRows } = await supabase.from("session_types").select("id, name, location_kind").eq("coach_id", user.id).order("name", { ascending: true });
  const sessionTypes = ((typeRows ?? []) as { id: string; name: string; location_kind: "in_person" | "online" | "either" | null }[]).map((t) => ({ id: t.id, name: t.name, locationKind: t.location_kind }));
  // Past sessions only (future ones would fill the list), newest first, a page at a time past the 1000-row cap.
  const nowIsoForTypes = new Date().toISOString();
  const typedBookings = await pageAll(
    (from, to) =>
      supabase
        .from("bookings")
        .select("id, athlete_id, session_type_id, start_at")
        .eq("coach_id", user.id)
        .not("session_type_id", "is", null)
        .lt("start_at", nowIsoForTypes)
        .order("start_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    { maxPages: 4 }
  );
  const lastTypes = lastTypeByClient(typedBookings.rows as { athlete_id: string; session_type_id: string | null; start_at: string }[]);
  const defaultTypeByClient: Record<string, string | null> = {};
  for (const c of clients) {
    defaultTypeByClient[c.profileId] = defaultSessionTypeId({ lastTypeId: lastTypes[c.profileId], tier: membershipByClient.get(`${c.groupId}:${c.profileId}`)?.tier, types: sessionTypes });
  }
  // Which of the coach's types each window of hours is set aside for (a guide, never a block).
  const { data: windowTypeRows } = await supabase.from("coach_availability_windows").select("id, session_type_id").eq("coach_id", user.id);
  const windowTypeById = new Map(((windowTypeRows ?? []) as { id: string; session_type_id: string | null }[]).map((r) => [r.id, r.session_type_id]));
  const windowsWithTypes = availabilityWindows.map((w) => ({ ...w, sessionTypeId: windowTypeById.get(w.id) ?? null }));
  const selectedClientId = searchParams.client;
  const todayKeyCoach = dateKeyInZone(timezone);

  // Each day travels to the browser as a "YYYY-MM-DD" key (never a Date made here in UTC), so every day sits under its own weekday.
  const cells = monthCellKeys(year, monthIndex);
  void leadingBlanks;
  void daysInMonth;

  const prevMonth = new Date(year, monthIndex - 1, 1);
  const nextMonth = new Date(year, monthIndex + 1, 1);
  const basePath = coachLevel ? "/calendar" : `/groups/${params.groupId}/calendar`;
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
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="calendar" coachLevel={coachLevel}>
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Calendar</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Your sessions with clients, your time off and your own events. A
          client&apos;s workouts live on their own calendar: tap a name to open
          it. Set your recurring hours on the Availability tab below.
        </p>
      </div>

      {calendarSpotterFindings.length > 0 && (
        <div className="mb-6">
          <CalendarSpotterPanel findings={calendarSpotterFindings} groupId={params.groupId} timezone={bookingTz} />
        </div>
      )}

      <SchedulingSpotterPanel flags={schedulingSpotterFlags} availabilityHref={`${basePath}?tab=availability`} />

      <AddGroupEvent groups={eventGroups} timezone={bookingTz} />

      <CalendarPageTabs
        coachId={user.id}
        initialWindows={availabilityWindows}
        sessionLengthEnabled={!sessionProbe.error}
        initialBufferMinutes={gapPolicy?.buffer_minutes ?? 0}
        initialTab={searchParams.tab === "availability" ? "availability" : "schedule"}
      >
      {/* mobile_must_fit_screen_standing_rule — this two-column layout
          (a fixed 260px "Needs attention"/"Clients" rail beside the
          grid) is desktop-shaped and never had a narrow-viewport
          breakpoint; a coach who lands here on a real phone (the
          "Desktop Mode" override, or just a wide-enough tablet width
          below lg) got the 260px column pushed off the right edge of
          the screen entirely, because CSS Grid's bare `1fr` track
          defaults to `minmax(auto, 1fr)` — its own min-content width
          (the 7-day calendar grid) can grow past its fair share and
          shove a fixed sibling column off-screen. min-w-0 on the first
          column defuses that regardless of breakpoint; grid-cols-1
          below lg stacks the two columns instead of forcing them
          side-by-side at a width that was never going to fit both. */}
      <CalendarSchedulingProvider
        initialClient={(() => {
          const c = clients.find((x) => x.profileId === selectedClientId);
          return c ? { athleteId: c.profileId, fullName: c.fullName, balance: c.balance, groupId: c.groupId } : null;
        })()}
      >
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-8 items-start">
        <div className="min-w-0">
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
                cellKeys={cells}
                todayKey={todayKeyCoach}
                bookingsByDateKey={bookingsByDateKey}
                eventsByDateKey={eventsByDateKey}
                blockedRanges={blockedRanges}
                availabilityWindows={windowsWithTypes}
                timezone={timezone}
                cellMinHeightPx={80}
                showAllBookings={false}
                bufferMinutes={gapPolicy?.buffer_minutes ?? 0}
                sessionTypes={sessionTypes}
                defaultTypeByClient={defaultTypeByClient}
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
                cellKeys={weekKeys(dateKey(weekStart))}
                todayKey={todayKeyCoach}
                bookingsByDateKey={bookingsByDateKey}
                eventsByDateKey={eventsByDateKey}
                blockedRanges={blockedRanges}
                availabilityWindows={windowsWithTypes}
                timezone={timezone}
                cellMinHeightPx={300}
                showAllBookings
                bufferMinutes={gapPolicy?.buffer_minutes ?? 0}
                sessionTypes={sessionTypes}
                defaultTypeByClient={defaultTypeByClient}
              />
            </>
          )}
        </div>

        <div className="min-w-0">
          <CalendarClientRail
            clients={clients}
            setAsideKeys={Array.from(setAsideKeySet)}
            selectedClientId={selectedClientId}
            timezone={timezone}
            sessionTypes={sessionTypes}
          />
          <CalendarAttentionChip items={attentionItems} />
        </div>
      </div>
      </CalendarSchedulingProvider>
      </CalendarPageTabs>
    </CoachDesktopShell>
  );
}
