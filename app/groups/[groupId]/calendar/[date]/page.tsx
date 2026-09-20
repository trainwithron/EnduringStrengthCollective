import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { generateSlotsForDate, formatSlotTime, minimumNoticeBlockedRange, isSlotBufferBlocked } from "@/lib/booking-slots";
import { getBlockedRangesForDate } from "@/lib/availability-exceptions";
import { zonedTimeToUtc, DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { AssignSlotButton } from "@/components/coach/desktop/assign-slot-button";
import { AssignWorkoutToDateButton } from "@/components/coach/desktop/assign-workout-to-date-button";
import { AddDayEventForm } from "@/components/coach/desktop/add-day-event-form";
import { getActiveProgramForAthlete, getAllProgramWorkouts, getScheduledWorkouts, dateKeyOf } from "@/lib/athlete-day-schedule";
import { BookSlotButton } from "@/components/athlete/book-slot-button";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
import { RescheduleSlotButton } from "@/components/athlete/reschedule-slot-button";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { DayHourGrid } from "@/components/coach/desktop/day-hour-grid";
import { CalendarPurchasePrompt } from "@/components/athlete/calendar-purchase-prompt";
import { VideoCallButton } from "@/components/booking/video-call-button";
import { BookingVideoPanel } from "@/components/coach/desktop/booking-video-panel";
import type { PackageOption } from "@/components/athlete/package-picker";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { meetsMinimumAge } from "@/lib/coppa";
import { MarkNoShowToggle } from "@/components/coach/mark-no-show-toggle";

export default async function CoachDayDetailPage(
  props: {
    params: Promise<{ groupId: string; date: string }>;
    searchParams: Promise<{ client?: string; reschedule?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Invalid date.</p>
      </main>
    );
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
          This group isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  // A coach "acting as" a client reaches this same booking view — that's
  // the whole point of impersonation, so real athletes and an impersonated
  // session both take this branch, keyed off the resolved athlete id
  // rather than the real signed-in user's own id.
  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const athleteId = effective.athleteId;

  let actingAsFullName: string | null = null;
  if (effective.isActingAsOther) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", athleteId)
      .maybeSingle();
    actingAsFullName = profile?.full_name ?? "Client";
  }

  // An athlete booking with their coach — same logic as the program-scoped
  // day-detail page, just reachable at the group level so it works even
  // with no active program assigned (a client should always be able to
  // see and book their coach's open hours).
  if (membership.role === "athlete" || effective.isActingAsOther) {
    // Independent of each other — coachMembership only needs groupId,
    // reschedulingBooking only needs athleteId + a searchParam — batched
    // per athlete_app_loading_time_investigation_sept14.md's finding that
    // this file had zero Promise.all across 19 sequential awaits.
    const [{ data: coachMembership }, { data: reschedulingBooking }] = await Promise.all([
      supabase
        .from("group_memberships")
        .select("profile_id")
        .eq("group_id", params.groupId)
        .eq("role", "coach")
        .limit(1)
        .maybeSingle(),
      searchParams.reschedule
        ? supabase
            .from("bookings")
            .select("id, start_at")
            .eq("id", searchParams.reschedule)
            .eq("athlete_id", athleteId)
            .eq("status", "confirmed")
            .maybeSingle()
        : Promise.resolve({ data: null as { id: string; start_at: string } | null }),
    ]);

    const date = new Date(`${params.date}T00:00:00`);

    let slots: { start: Date; durationMinutes: number }[] = [];
    let bookingsForDay: any[] = [];
    let creditBalance = 0;
    let activeSubscription: { currentPeriodEnd: string | null } | null = null;
    let availablePackages: PackageOption[] = [];
    let bufferBlockingBookings: { id: string; start: Date; end: Date }[] = [];
    let resolvedBufferMinutes = 0;

    if (coachMembership) {
      // Wave 1: none of these five depend on each other — coachProfile's
      // timezone is only needed by wave 2, not by any of the other four.
      const [
        { data: coachProfile },
        { data: windowRows },
        { data: creditsRow },
        { data: subscriptionRow },
        { data: packageRows },
        { data: policyRow },
      ] = await Promise.all([
        supabase.from("profiles").select("timezone").eq("id", coachMembership.profile_id).maybeSingle(),
        supabase
          .from("coach_availability_windows")
          .select("weekday, start_time, end_time, slot_duration_minutes")
          .eq("coach_id", coachMembership.profile_id),
        supabase
          .from("session_credits")
          .select("balance")
          .eq("athlete_id", athleteId)
          .eq("group_id", params.groupId)
          .maybeSingle(),
        supabase
          .from("membership_subscriptions")
          .select("current_period_end")
          .eq("athlete_id", athleteId)
          .eq("group_id", params.groupId)
          .eq("status", "active")
          .maybeSingle(),
        supabase
          .from("coach_packages")
          .select("id, name, sessions_per_week, billing_type, sessions_granted, rate_cents")
          .eq("group_id", params.groupId)
          .eq("is_active", true)
          .order("sessions_per_week", { ascending: true }),
        supabase
          .from("coach_booking_policies")
          .select("buffer_minutes, minimum_notice_hours")
          .eq("coach_id", coachMembership.profile_id)
          .maybeSingle(),
      ]);

      const timezone = coachProfile?.timezone ?? DEFAULT_COACH_TIMEZONE;
      const windows = (windowRows ?? []).map((w) => ({
        weekday: w.weekday,
        startTime: w.start_time,
        endTime: w.end_time,
        slotDurationMinutes: w.slot_duration_minutes,
      }));
      creditBalance = creditsRow?.balance ?? 0;
      activeSubscription = subscriptionRow ? { currentPeriodEnd: subscriptionRow.current_period_end } : null;
      availablePackages = (packageRows ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        sessionsPerWeek: p.sessions_per_week,
        billingType: p.billing_type as "subscription" | "one_time",
        sessionsGranted: p.sessions_granted,
        rateCents: p.rate_cents,
      }));

      const zonedDayStart = zonedTimeToUtc(params.date, "00:00", timezone);
      const zonedDayEnd = new Date(zonedDayStart.getTime() + 24 * 60 * 60 * 1000);
      const bufferMinutes = policyRow?.buffer_minutes ?? 0;
      const minimumNoticeHours = policyRow?.minimum_notice_hours ?? 0;

      // Wave 2: both need timezone from wave 1, but not each other.
      const [blockedRangesFromExceptions, { data: bookingRows }] = await Promise.all([
        getBlockedRangesForDate(supabase, coachMembership.profile_id, date, timezone),
        supabase
          .from("bookings")
          .select("id, start_at, end_at, athlete_id, session_type, profiles!bookings_athlete_id_fkey ( full_name )")
          .eq("coach_id", coachMembership.profile_id)
          .eq("status", "confirmed")
          .gte("start_at", zonedDayStart.toISOString())
          .lt("start_at", zonedDayEnd.toISOString()),
      ]);

      // acuity_replacement_gap_audit_sept16.md — a too-soon slot is
      // excluded from generation entirely (real athletes only; a coach
      // "acting as" a client for real still books through this same
      // branch, and correctly stays subject to their own notice rule,
      // same as book_session's own v_is_self gate).
      const noticeRange = minimumNoticeBlockedRange(new Date(), minimumNoticeHours);
      const blockedRanges = noticeRange ? [...blockedRangesFromExceptions, noticeRange] : blockedRangesFromExceptions;

      slots = generateSlotsForDate(date, windows, blockedRanges, timezone);
      bookingsForDay = bookingRows ?? [];
      bufferBlockingBookings = bookingsForDay.map((b) => ({
        id: b.id as string,
        start: new Date(b.start_at as string),
        end: new Date(b.end_at as string),
      }));
      resolvedBufferMinutes = bufferMinutes;
    }

    const bookingByTime = new Map(
      bookingsForDay.map((b) => [new Date(b.start_at).getTime(), b])
    );
    const backHref = `/groups/${params.groupId}/calendar`;

    return (
      <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
        {effective.isActingAsOther && (
          <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
        )}
        <header className="px-5 pt-8 pb-6 border-b border-steel/20">
          <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
            &larr; Back to calendar
          </Link>
          <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">
            {date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </h1>
          {coachMembership && (
            <div className="mt-3">
              <p className="font-body text-xs text-steel">
                Session credits available: {creditBalance}
              </p>
              {creditBalance <= 0 && !reschedulingBooking && (
                <div className="mt-2">
                  <CalendarPurchasePrompt activeSubscription={activeSubscription} packages={availablePackages} />
                </div>
              )}
            </div>
          )}
          {reschedulingBooking && (
            <p className="font-body text-xs text-rust mt-2">
              Picking a new time for your{" "}
              {new Date(reschedulingBooking.start_at).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}{" "}
              session — moving less than your coach&apos;s cancellation window
              before that session still forfeits the credit.
            </p>
          )}
        </header>

        <section className="px-5 pt-6">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            {reschedulingBooking ? "Pick a new time" : "Open sessions"}
          </h2>

          {!coachMembership ? (
            <p className="font-body text-sm text-steel py-2">No coach found for this group.</p>
          ) : slots.length === 0 ? (
            <p className="font-body text-sm text-steel py-2">No open hours on this day.</p>
          ) : (
            <div className="divide-y divide-steel/15">
              {slots.map(({ start, durationMinutes }) => {
                const iso = start.toISOString();
                const booking = bookingByTime.get(start.getTime());
                const isMine = booking?.athlete_id === athleteId;
                const isBeingRescheduled = !!reschedulingBooking && booking?.id === reschedulingBooking.id;
                const endAt = new Date(start.getTime() + durationMinutes * 60000);
                // Real server-side enforcement lives in book_session/
                // reschedule_booking — this mirrors it so an open (but
                // buffer-blocked) slot doesn't invite a click that the
                // RPC would just reject. Excludes the booking currently
                // being rescheduled from its own buffer check.
                const isBufferBlocked =
                  !booking &&
                  isSlotBufferBlocked(
                    start,
                    endAt,
                    bufferBlockingBookings.filter((b) => b.id !== reschedulingBooking?.id),
                    resolvedBufferMinutes
                  );

                return (
                  <div key={iso} className="py-3 flex items-center justify-between">
                    <span className="font-body font-medium text-[15px]">
                      {formatSlotTime(start)}
                    </span>

                    {isBeingRescheduled ? (
                      <span className="font-body text-xs text-steel">Currently here</span>
                    ) : reschedulingBooking ? (
                      booking ? (
                        <span className="font-body text-xs text-steel">Booked</span>
                      ) : isBufferBlocked ? (
                        <span className="font-body text-xs text-steel">Too close to another session</span>
                      ) : (
                        <RescheduleSlotButton
                          bookingId={reschedulingBooking.id}
                          startAt={iso}
                          endAt={endAt.toISOString()}
                        />
                      )
                    ) : booking ? (
                      isMine ? (
                        <div className="flex items-center gap-2">
                          {booking.session_type === "video" && <VideoCallButton bookingId={booking.id} />}
                          <CancelBookingButton
                            bookingId={booking.id}
                            rescheduleHref={`${backHref}/${params.date}?reschedule=${booking.id}`}
                          />
                        </div>
                      ) : (
                        <span className="font-body text-xs text-steel">Booked</span>
                      )
                    ) : isBufferBlocked ? (
                      <span className="font-body text-xs text-steel">Too close to another session</span>
                    ) : creditBalance > 0 ? (
                      <BookSlotButton
                        coachId={coachMembership.profile_id}
                        athleteId={athleteId}
                        groupId={params.groupId}
                        startAt={iso}
                        endAt={endAt.toISOString()}
                      />
                    ) : (
                      <span className="font-body text-xs text-steel">No sessions remaining</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
      </main>
    );
  }

  if (membership.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can view this page.</p>
      </main>
    );
  }

  const date = new Date(`${params.date}T00:00:00`);
  // Selected client to assign into an open slot — carried via ?client= so
  // it survives the coach clicking through from either the client profile
  // or the main calendar's sidebar.
  const clientId = searchParams.client;

  // Wave 1: group, viewerProfile, windowRows, dayEventRows, and the
  // clientId membership check are all independent of each other — none
  // needs another's result. Same fix shape as performance_fix_region_
  // and_query_batching.md; this file (calendar/[date]/page.tsx) was the
  // primary suspect in athlete_app_loading_time_investigation_sept14.md
  // (19 sequential awaits, zero Promise.all) and was never touched by
  // that earlier pass.
  const [
    { data: group },
    { data: viewerProfile },
    { data: windowRows },
    { data: dayEventRows },
    { data: clientMembership },
  ] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    supabase
      .from("coach_availability_windows")
      .select("weekday, start_time, end_time, slot_duration_minutes")
      .eq("coach_id", user.id),
    // Custom to-dos/events for this exact date — folded into this day's
    // hour-by-hour view so a coach sees everything they've got going on
    // (not just bookable slots) in one place, matching what the month/
    // week grid already surfaces per-cell.
    supabase
      .from("calendar_events")
      .select("id, title, event_time")
      .eq("coach_id", user.id)
      .eq("event_date", params.date)
      .neq("status", "dismissed")
      .order("event_time", { ascending: true }),
    clientId
      ? supabase
          .from("group_memberships")
          .select("profiles ( full_name )")
          .eq("group_id", params.groupId)
          .eq("profile_id", clientId)
          .eq("role", "athlete")
          .maybeSingle()
      : Promise.resolve({ data: null as { profiles: unknown } | null }),
  ]);

  const timezone = viewerProfile?.timezone ?? DEFAULT_COACH_TIMEZONE;
  const windows = (windowRows ?? []).map((w) => ({
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
  }));

  const zonedDayStart = zonedTimeToUtc(params.date, "00:00", timezone);
  const zonedDayEnd = new Date(zonedDayStart.getTime() + 24 * 60 * 60 * 1000);

  // Wave 2: blockedRanges/bookingRows need wave 1's timezone but not each
  // other; the credits/program lookups need only clientId (gated on
  // clientMembership existing, resolved in wave 1) — all four independent.
  const [blockedRanges, { data: bookingRows }, { data: creditsForClient }, activeProgram] = await Promise.all([
    getBlockedRangesForDate(supabase, user.id, date, timezone),
    supabase
      .from("bookings")
      .select("id, start_at, end_at, athlete_id, session_type, no_show, profiles!bookings_athlete_id_fkey ( full_name )")
      .eq("coach_id", user.id)
      .eq("status", "confirmed")
      .gte("start_at", zonedDayStart.toISOString())
      .lt("start_at", zonedDayEnd.toISOString()),
    clientMembership
      ? supabase.from("session_credits").select("balance").eq("athlete_id", clientId!).eq("group_id", params.groupId).maybeSingle()
      : Promise.resolve({ data: null as { balance: number } | null }),
    clientMembership ? getActiveProgramForAthlete(supabase, params.groupId, clientId!) : Promise.resolve(null),
  ]);

  const slots = generateSlotsForDate(date, windows, blockedRanges, timezone);
  const bookingByTime = new Map(
    (bookingRows ?? []).map((b) => [new Date(b.start_at).getTime(), b as any])
  );

  // Video calling is 18+ only (Ron's direct instruction) — the API
  // route is the real enforcement; this is just so a coach isn't
  // offered a "Make video call" control for a client it will only
  // reject for. A missing/unconfirmed date of birth is NOT eligible,
  // same "requires positive confirmation" rule as the server-side check.
  // Genuinely dependent on bookingRows (wave 2) — can't be batched
  // earlier, it needs the athlete ids from those rows.
  const bookingAthleteIds = Array.from(new Set((bookingRows ?? []).map((b) => b.athlete_id)));
  const videoEligibleAthleteIds = new Set<string>();
  if (bookingAthleteIds.length > 0) {
    const { data: intakeRows } = await supabase
      .from("client_intake")
      .select("athlete_id, date_of_birth")
      .in("athlete_id", bookingAthleteIds);
    for (const row of intakeRows ?? []) {
      if (row.date_of_birth && meetsMinimumAge(row.date_of_birth, 18, new Date())) {
        videoEligibleAthleteIds.add(row.athlete_id);
      }
    }
  }

  let selectedClient: { fullName: string; balance: number } | null = null;
  // Day-click-to-assign (calendar_workout_scheduling_and_adjustable_
  // workspace_idea.md item 1) — the selected client's program workouts,
  // offered for pinning to this exact date. Empty when they have no
  // active program at all (nothing to assign, not an error state).
  let assignableWorkouts: { id: string; title: string; alreadyHere: boolean }[] = [];

  if (clientMembership) {
    selectedClient = {
      fullName: (clientMembership.profiles as any)?.full_name ?? "Client",
      balance: creditsForClient?.balance ?? 0,
    };

    if (activeProgram) {
      const [allWorkouts, scheduledWorkouts] = await Promise.all([
        getAllProgramWorkouts(supabase, activeProgram.id),
        getScheduledWorkouts(supabase, activeProgram),
      ]);
      const scheduledDateKeyByWorkoutId = new Map(
        scheduledWorkouts.map((w) => [w.workoutId, dateKeyOf(w.date)])
      );
      assignableWorkouts = allWorkouts.map((w) => ({
        id: w.id,
        title: w.title,
        alreadyHere: scheduledDateKeyByWorkoutId.get(w.id) === params.date,
      }));
    }
  }

  const backHref = `/groups/${params.groupId}/calendar`;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="calendar">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back to calendar
        </Link>
        <h1 className="font-display font-bold text-3xl uppercase leading-none mt-3">
          {date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </h1>
        {selectedClient ? (
          <p className="font-body text-sm text-steel mt-3">
            Assigning for <span className="text-chalk font-medium">{selectedClient.fullName}</span>
            {" — "}
            {selectedClient.balance} session{selectedClient.balance === 1 ? "" : "s"} remaining
          </p>
        ) : (
          <p className="font-body text-xs text-steel mt-3">
            Pick a client from the calendar sidebar to assign them into an open slot.
          </p>
        )}
      </div>

      {selectedClient && assignableWorkouts.length > 0 && (
        <div className="mb-6 max-w-lg">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            Assign a workout to this day
          </h2>
          <div className="divide-y divide-steel/15 border border-steel/20">
            {assignableWorkouts.map((w) => (
              <div key={w.id} className="py-2.5 px-3 flex items-center justify-between gap-3">
                <span className="font-body text-sm text-chalk truncate">{w.title}</span>
                <AssignWorkoutToDateButton workoutId={w.id} dateKey={params.date} alreadyHere={w.alreadyHere} />
              </div>
            ))}
          </div>
        </div>
      )}

      <DayHourGrid
        windows={windows.filter((w) => w.weekday === date.getDay())}
        bookings={(bookingRows ?? []).map((b: any) => ({
          id: b.id,
          start: new Date(b.start_at),
          end: new Date(b.end_at),
          label: b.profiles?.full_name ?? "Client",
        }))}
        events={(dayEventRows ?? []).map((e) => ({ id: e.id, time: e.event_time, title: e.title }))}
      />

      <AddDayEventForm coachId={user.id} dateKey={params.date} />

      {dayEventRows && dayEventRows.length > 0 && (
        <div className="mb-6 max-w-lg">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
            To-dos &amp; events
          </h2>
          <div className="divide-y divide-steel/15">
            {dayEventRows.map((e) => (
              <div key={e.id} className="py-2 flex items-center justify-between">
                <span className="font-body text-sm text-chalk">{e.title}</span>
                {e.event_time && (
                  <span className="font-body text-xs text-steel">{e.event_time.slice(0, 5)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {slots.length === 0 ? (
        <p className="font-body text-sm text-steel py-2">No open hours on this day.</p>
      ) : (
        <div className="divide-y divide-steel/15 max-w-lg">
          {slots.map(({ start, durationMinutes }) => {
            const iso = start.toISOString();
            const booking = bookingByTime.get(start.getTime());
            const endAt = new Date(start.getTime() + durationMinutes * 60000);

            return (
              <div key={iso} className="py-3 flex items-center justify-between">
                <span className="font-body font-medium text-[15px]">{formatSlotTime(start)}</span>

                {booking ? (
                  <div className="flex items-center gap-2">
                    <span className="font-body text-xs text-steel">
                      Booked — {(booking.profiles as any)?.full_name ?? "Client"}
                    </span>
                    {start.getTime() < Date.now() ? (
                      <MarkNoShowToggle bookingId={booking.id} initialNoShow={booking.no_show ?? false} />
                    ) : (
                      <CancelBookingButton bookingId={booking.id} />
                    )}
                    {videoEligibleAthleteIds.has(booking.athlete_id) && (
                      <BookingVideoPanel bookingId={booking.id} initialSessionType={booking.session_type ?? "in_person"} />
                    )}
                  </div>
                ) : selectedClient ? (
                  selectedClient.balance > 0 ? (
                    <AssignSlotButton
                      coachId={user.id}
                      athleteId={clientId!}
                      groupId={params.groupId}
                      startAt={iso}
                      endAt={endAt.toISOString()}
                    />
                  ) : (
                    <span className="font-body text-xs text-steel">No sessions remaining</span>
                  )
                ) : (
                  <span className="font-body text-xs text-steel">Open</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CoachDesktopShell>
  );
}
