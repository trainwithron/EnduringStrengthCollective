import { fetchSessionMinutes, sessionMinutesFor } from "@/lib/availability-windows";
import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { generateSlotsForDate, formatSlotTime, minimumNoticeBlockedRange, slotConflict, customStartOptions } from "@/lib/booking-slots";
import { expiryWindowLine } from "@/lib/expiry-checkin";
import { creditExpiryDate } from "@/lib/credit-expiration";
import { getBlockedRangesForDate } from "@/lib/availability-exceptions";
import { zonedTimeToUtc, DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { addDaysToDateKey } from "@/lib/series-schedule";
import { coachBalanceLabel } from "@/lib/reup";
import { AssignSlotButton } from "@/components/coach/desktop/assign-slot-button";
import { AssignOtherTime } from "@/components/coach/desktop/assign-other-time";
import { BookingTypeSelect } from "@/components/coach/desktop/booking-type-select";
import { AssignWorkoutToDateButton } from "@/components/coach/desktop/assign-workout-to-date-button";
import { AddDayEventForm } from "@/components/coach/desktop/add-day-event-form";
import { getActiveProgramForAthlete, getAllProgramWorkouts, getScheduledWorkouts, dateKeyOf } from "@/lib/athlete-day-schedule";
import { BookSlotButton } from "@/components/athlete/book-slot-button";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
import { MarkAttendedControl, type CreditState } from "@/components/coach/mark-attended-control";
import { RescheduleSlotButton } from "@/components/athlete/reschedule-slot-button";
import { RequestSlotButton } from "@/components/athlete/request-slot-button";
import { RequestDifferentTime } from "@/components/athlete/request-different-time";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { DayHourGrid } from "@/components/coach/desktop/day-hour-grid";
import { CalendarPurchasePrompt } from "@/components/athlete/calendar-purchase-prompt";
import { isStripeConfigured } from "@/lib/stripe";
import { VideoCallButton } from "@/components/booking/video-call-button";
import { BookingVideoPanel } from "@/components/coach/desktop/booking-video-panel";
import type { PackageOption } from "@/components/athlete/package-picker";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { meetsMinimumAge } from "@/lib/coppa";
import { MarkNoShowToggle } from "@/components/coach/mark-no-show-toggle";
import { WaitlistJoinButton } from "@/components/athlete/waitlist-join-button";
import { RecurringBookingButton } from "@/components/athlete/recurring-booking-button";
import { RecurringConflictBadge } from "@/components/coach/desktop/recurring-conflict-badge";
import { sessionBalanceLine, NO_SESSIONS_SLOT_LABEL } from "@/lib/session-credit-copy";

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
      <NoAccess>Invalid date.</NoAccess>
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
      <NoAccess>This group isn&apos;t available, or you don&apos;t have access to it.</NoAccess>
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
    let creditExpiresAt: Date | null = null;
    let creditExpiryDaysForNote = 0;
    let activeSubscription: { currentPeriodEnd: string | null } | null = null;
    let availablePackages: PackageOption[] = [];
    let bufferBlockingBookings: { id: string; start: Date; end: Date }[] = [];
    let resolvedBufferMinutes = 0;
    // Start times a client can ask for beyond the regular slots (request mode): every 5 minutes inside the hours, clear of time off and other sessions.
    let customStarts: { start: Date; durationMinutes: number }[] = [];
    let dayStartUtc: Date | null = null;
    let dayEndUtc: Date | null = null;
    let waitlistStatusByTime = new Map<number, "waiting" | "offered">();

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
        { data: waitlistRows },
      ] = await Promise.all([
        supabase.from("profiles").select("timezone").eq("id", coachMembership.profile_id).maybeSingle(),
        supabase
          .from("coach_availability_windows")
          .select("weekday, start_time, end_time, slot_duration_minutes")
          .eq("coach_id", coachMembership.profile_id),
        supabase
          .from("session_credits")
          .select("balance, last_granted_at")
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
          .select("buffer_minutes, minimum_notice_hours, credit_expiry_days")
          .eq("coach_id", coachMembership.profile_id)
          .maybeSingle(),
        supabase
          .from("booking_waitlist_entries")
          .select("slot_start_at, status")
          .eq("athlete_id", athleteId)
          .eq("coach_id", coachMembership.profile_id)
          .in("status", ["waiting", "offered"]),
      ]);
      waitlistStatusByTime = new Map(
        (waitlistRows ?? []).map((w) => [new Date(w.slot_start_at).getTime(), w.status as "waiting" | "offered"])
      );

      const timezone = coachProfile?.timezone ?? DEFAULT_COACH_TIMEZONE;
      const sessionIndex = await fetchSessionMinutes(supabase, [coachMembership.profile_id]);
      const windows = (windowRows ?? []).map((w) => ({
        weekday: w.weekday,
        startTime: w.start_time,
        endTime: w.end_time,
        slotDurationMinutes: w.slot_duration_minutes,
        sessionMinutes: sessionMinutesFor(sessionIndex, coachMembership.profile_id, w),
      }));
      creditBalance = creditsRow?.balance ?? 0;
      creditExpiresAt = creditExpiryDate(creditsRow?.last_granted_at ?? null, policyRow?.credit_expiry_days ?? 0);
      creditExpiryDaysForNote = policyRow?.credit_expiry_days ?? 0;
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
      // The next local midnight, not +24 hours: a day with a clock change is 23 or 25 hours long.
      const zonedDayEnd = zonedTimeToUtc(addDaysToDateKey(params.date, 1), "00:00", timezone);
      dayStartUtc = zonedDayStart;
      dayEndUtc = zonedDayEnd;
      const bufferMinutes = policyRow?.buffer_minutes ?? 0;
      const minimumNoticeHours = policyRow?.minimum_notice_hours ?? 0;

      // Wave 2: both need timezone from wave 1, but not each other.
      const [blockedRangesFromExceptions, { data: bookingRows }] = await Promise.all([
        getBlockedRangesForDate(supabase, coachMembership.profile_id, date, timezone),
        supabase
          .from("bookings")
          .select(
            "id, start_at, end_at, athlete_id, session_type, recurring_series_id, profiles!bookings_athlete_id_fkey ( full_name )"
          )
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
      customStarts = customStartOptions({
        date,
        windows,
        blockedRanges,
        bookings: bufferBlockingBookings,
        bufferMinutes,
        timezone,
        excludeStarts: new Set(slots.map((s) => s.start.getTime())),
      });
    }

    const bookingByTime = new Map(
      bookingsForDay.map((b) => [new Date(b.start_at).getTime(), b])
    );

    // Clients book themselves only when the coach has switched self-booking on (off by default; the database enforces it too). When it is
    // off, the open times are not offered; the client still sees their own sessions and can cancel or move them.
    let bookingMode = "free" as "free" | "request" | "coach_schedules";
    if (coachMembership) {
      const sb = await supabase
        .from("coach_booking_policies")
        .select("booking_mode")
        .eq("coach_id", coachMembership.profile_id)
        .maybeSingle();
      // Until the database update that adds the switch is applied, the select errors and booking behaves as before.
      if (!sb.error) bookingMode = ((sb.data?.booking_mode as string | null) ?? "coach_schedules") as typeof bookingMode;
    // A coach (booking for a client they are viewing as, or for themselves) is never refused: they book directly.
    if (membership.role === "coach") bookingMode = "free";
    }
    if (bookingMode === "coach_schedules") {
      slots = slots.filter((s) => bookingByTime.get(s.start.getTime())?.athlete_id === athleteId);
    }
    // Times this client has already asked for (pending requests), so the slot says "Requested" instead of offering the button again.
    const requestedTimes = new Set<number>();
    // Requests at a time that is not one of the slots (asked for with "Ask for a different time") are listed on their own, so nothing the client asked for is lost.
    const offGridRequests: { start: Date; end: Date }[] = [];
    if (bookingMode === "request") {
      const { data: pendingRows } = await supabase
        .from("booking_requests")
        .select("new_start_at, new_end_at")
        .eq("athlete_id", athleteId)
        .eq("status", "pending");
      for (const r of pendingRows ?? []) requestedTimes.add(new Date(r.new_start_at as string).getTime());
      const slotStarts = new Set(slots.map((s) => s.start.getTime()));
      for (const r of pendingRows ?? []) {
        const s = new Date(r.new_start_at as string);
        const e = new Date((r.new_end_at as string | null) ?? (r.new_start_at as string));
        if (!slotStarts.has(s.getTime()) && dayStartUtc && dayEndUtc && s >= dayStartUtc && s < dayEndUtc) offGridRequests.push({ start: s, end: e });
      }
    }
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
                {sessionBalanceLine(creditBalance)}
                {creditBalance > 0 && creditExpiresAt && (
                  <span className="text-steel">
                    {" "}
                    — expires{" "}
                    {creditExpiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
              </p>
              {expiryWindowLine(creditExpiryDaysForNote) && (
                <p className="font-body text-xs text-steel mt-1">{expiryWindowLine(creditExpiryDaysForNote)}</p>
              )}
              {creditBalance <= 0 && !reschedulingBooking && isStripeConfigured() && (
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
              session — moving it less than your coach&apos;s cancellation window
              before that session lets your coach know, and they decide whether it counts as a session.
              {bookingMode === "request" && " Your coach confirms every move: your session stays where it is until they do."}
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
            <p className="font-body text-sm text-steel py-2">
              {bookingMode === "coach_schedules"
                ? "Your coach schedules your sessions. Message them to set one up."
                : "No open hours on this day."}
            </p>
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
                const conflict = booking
                  ? null
                  : slotConflict(
                      start,
                      endAt,
                      bufferBlockingBookings.filter((b) => b.id !== reschedulingBooking?.id),
                      resolvedBufferMinutes
                    );
                const isBufferBlocked = conflict !== null;

                return (
                  <div key={iso} className="py-3 flex items-center justify-between">
                    <span className="font-body font-medium text-[15px]">
                      {formatSlotTime(start, timezone)}
                    </span>

                    {isBeingRescheduled ? (
                      <span className="font-body text-xs text-steel">Currently here</span>
                    ) : reschedulingBooking ? (
                      booking ? (
                        <span className="font-body text-xs text-steel">Booked</span>
                      ) : isBufferBlocked ? (
                        <span className="font-body text-xs text-steel">{conflict === "taken" ? "Booked" : "Too close to another session"}</span>
                      ) : (
                        <RescheduleSlotButton
                          requestOnly={bookingMode === "request"}
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
                            recurringSeriesId={booking.recurring_series_id}
                          />
                        </div>
                      ) : (
                        <WaitlistJoinButton
                          coachId={coachMembership.profile_id}
                          athleteId={athleteId}
                          groupId={params.groupId}
                          slotStartAt={iso}
                          slotEndAt={endAt.toISOString()}
                          existingStatus={waitlistStatusByTime.get(start.getTime()) ?? null}
                        />
                      )
                    ) : isBufferBlocked ? (
                      <span className="font-body text-xs text-steel">{conflict === "taken" ? "Booked" : "Too close to another session"}</span>
                    ) : bookingMode === "request" && requestedTimes.has(start.getTime()) ? (
                      <span className="font-body text-xs text-chalk">Requested. Waiting for your coach.</span>
                    ) : bookingMode === "request" ? (
                      <RequestSlotButton
                        coachId={coachMembership.profile_id}
                        athleteId={athleteId}
                        groupId={params.groupId}
                        startAt={iso}
                        endAt={endAt.toISOString()}
                      />
                    ) : creditBalance > 0 ? (
                      <div className="flex flex-col items-end gap-1">
                        <BookSlotButton
                          coachId={coachMembership.profile_id}
                          athleteId={athleteId}
                          groupId={params.groupId}
                          startAt={iso}
                          endAt={endAt.toISOString()}
                        />
                        <RecurringBookingButton
                          coachId={coachMembership.profile_id}
                          athleteId={athleteId}
                          groupId={params.groupId}
                          startAt={iso}
                          durationMinutes={durationMinutes}
                        />
                      </div>
                    ) : (
                      <span className="font-body text-xs text-steel">{NO_SESSIONS_SLOT_LABEL}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {bookingMode === "request" && offGridRequests.length > 0 && (
            <div className="mt-4">
              <h3 className="font-display uppercase text-xs tracking-wide text-steel mb-1">Waiting for your coach</h3>
              {offGridRequests.map((r) => (
                <p key={r.start.getTime()} className="font-body text-sm text-chalk">
                  {formatSlotTime(r.start, timezone)} to {formatSlotTime(r.end, timezone)}
                </p>
              ))}
            </div>
          )}
          {bookingMode === "request" && !reschedulingBooking && coachMembership && customStarts.length > 0 && (
            <RequestDifferentTime
              coachId={coachMembership.profile_id}
              athleteId={athleteId}
              groupId={params.groupId}
              sessionMinutes={customStarts[0]?.durationMinutes ?? null}
              options={customStarts.map((o) => ({
                startAt: o.start.toISOString(),
                endAt: new Date(o.start.getTime() + o.durationMinutes * 60000).toISOString(),
                label: formatSlotTime(o.start, timezone),
              }))}
            />
          )}
        </section>

        <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
      </main>
    );
  }

  if (membership.role !== "coach") {
    return (
      <NoAccess>Only coaches can view this page.</NoAccess>
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
  const sessionIndex = await fetchSessionMinutes(supabase, [user.id]);
  const windows = (windowRows ?? []).map((w) => ({
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
    sessionMinutes: sessionMinutesFor(sessionIndex, user.id, w),
  }));

  const zonedDayStart = zonedTimeToUtc(params.date, "00:00", timezone);
  const zonedDayEnd = zonedTimeToUtc(addDaysToDateKey(params.date, 1), "00:00", timezone);

  // Wave 2: blockedRanges/bookingRows need wave 1's timezone but not each
  // other; the credits/program lookups need only clientId (gated on
  // clientMembership existing, resolved in wave 1) — all four independent.
  const [blockedRanges, { data: bookingRows }, { data: creditsForClient }, activeProgram] = await Promise.all([
    getBlockedRangesForDate(supabase, user.id, date, timezone),
    supabase
      .from("bookings")
      .select(
        "id, start_at, end_at, athlete_id, session_type, no_show, needs_coach_resolution, recurring_series_id, profiles!bookings_athlete_id_fkey ( full_name )"
      )
      .eq("coach_id", user.id)
      .eq("status", "confirmed")
      .gte("start_at", zonedDayStart.toISOString())
      .lt("start_at", zonedDayEnd.toISOString()),
    clientMembership
      ? supabase.from("session_credits").select("balance").eq("athlete_id", clientId!).eq("group_id", params.groupId).maybeSingle()
      : Promise.resolve({ data: null as { balance: number } | null }),
    clientMembership ? getActiveProgramForAthlete(supabase, params.groupId, clientId!) : Promise.resolve(null),
  ]);

  // The coach's session types and each booked session's type (migration 0261 / 0289). Soft: if the lookup fails the type control simply does not appear.
  const { data: coachTypeRows } = await supabase.from("session_types").select("id, name").eq("coach_id", user.id).order("created_at", { ascending: true });
  const coachTypes = (coachTypeRows ?? []) as { id: string; name: string }[];
  const typeByBooking = new Map<string, string | null>();
  if (coachTypes.length > 0 && (bookingRows ?? []).length > 0) {
    const { data: typeRows, error: typeError } = await supabase.from("bookings").select("id, session_type_id").in("id", (bookingRows ?? []).map((b) => b.id));
    if (!typeError) for (const r of (typeRows ?? []) as { id: string; session_type_id: string | null }[]) typeByBooking.set(r.id, r.session_type_id ?? null);
  }

  // Settlement state (migration 0248). If those columns are not there yet this lookup errors and the Mark attended
  // control simply does not appear.
  const settlementById = new Map<string, { credit_state: CreditState; attended_at: string | null }>();
  if ((bookingRows ?? []).length > 0) {
    const { data: settlementRows, error: settlementError } = await supabase
      .from("bookings")
      .select("id, credit_state, attended_at")
      .in("id", (bookingRows ?? []).map((b) => b.id));
    if (!settlementError) {
      for (const r of settlementRows ?? []) {
        settlementById.set(r.id as string, { credit_state: r.credit_state as CreditState, attended_at: (r.attended_at as string | null) ?? null });
      }
    }
  }

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

  const slotStartTimes = new Set(slots.map((sl) => sl.start.getTime()));
  const otherBookings = (bookingRows ?? []).filter((b: any) => !slotStartTimes.has(new Date(b.start_at).getTime()));

  // One booked session: who, then the controls that settle or change it. Used for sessions on a slot and for ones off the slots.
  const renderBooked = (booking: any, start: Date) => (
    <div className="flex flex-wrap items-center gap-2 min-w-0">
      <span className="font-body text-xs text-steel">Booked — {(booking.profiles as any)?.full_name ?? "Client"}</span>
      {booking.needs_coach_resolution && <RecurringConflictBadge bookingId={booking.id} />}
      {typeByBooking.has(booking.id) && <BookingTypeSelect bookingId={booking.id} types={coachTypes} current={typeByBooking.get(booking.id) ?? null} />}
      {settlementById.has(booking.id) && start.getTime() <= Date.now() + 12 * 3600 * 1000 && (
        <MarkAttendedControl
          bookingId={booking.id}
          initialAttended={settlementById.get(booking.id)!.attended_at !== null}
          initialState={settlementById.get(booking.id)!.credit_state}
          athleteId={booking.athlete_id}
          groupId={params.groupId}
        />
      )}
      {start.getTime() < Date.now() ? (
        <MarkNoShowToggle bookingId={booking.id} initialNoShow={booking.no_show ?? false} />
      ) : (
        <CancelBookingButton bookingId={booking.id} viewer="coach" recurringSeriesId={booking.recurring_series_id ?? null} />
      )}
      {videoEligibleAthleteIds.has(booking.athlete_id) && (
        <BookingVideoPanel bookingId={booking.id} initialSessionType={booking.session_type ?? "in_person"} />
      )}
    </div>
  );

  // Back to the calendar with the same client still picked (the phone calendar reads scheduleFor, the desktop one client).
  const backHref = clientId
    ? `/groups/${params.groupId}/calendar?client=${clientId}&scheduleFor=${clientId}`
    : `/groups/${params.groupId}/calendar`;

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
            {coachBalanceLabel(selectedClient.balance)}
          </p>
        ) : (
          <p className="font-body text-xs text-steel mt-3">
            Pick a client from the calendar to assign them into an open slot.
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
        timeZone={timezone}
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

      {slots.length === 0 && (bookingRows ?? []).length === 0 ? (
        <p className="font-body text-sm text-steel py-2">No open hours on this day.</p>
      ) : (
        <div className="divide-y divide-steel/15 max-w-lg">
          {slots.map(({ start, durationMinutes }) => {
            const iso = start.toISOString();
            const booking = bookingByTime.get(start.getTime());
            const endAt = new Date(start.getTime() + durationMinutes * 60000);
            // A slot that overlaps a session booked at another time cannot be assigned either.
            const clash = !booking && (bookingRows ?? []).some((b: any) => new Date(b.start_at) < endAt && new Date(b.end_at) > start);

            return (
              <div key={iso} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <span className="font-body font-medium text-[15px]">{formatSlotTime(start, timezone)}</span>

                {booking ? (
                  renderBooked(booking, start)
                ) : clash ? (
                  <span className="font-body text-xs text-steel">Busy</span>
                ) : selectedClient ? (
                  <AssignSlotButton
                    coachId={user.id}
                    athleteId={clientId!}
                    groupId={params.groupId}
                    startAt={iso}
                    endAt={endAt.toISOString()}
                  />
                ) : (
                  <span className="font-body text-xs text-steel">Open</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* A coach is human about times: book at any start in 5-minute steps and any length, not only the slot starts. */}
      {selectedClient && clientId && (
        <AssignOtherTime
          coachId={user.id}
          athleteId={clientId}
          groupId={params.groupId}
          dateKey={params.date}
          timezone={timezone}
          defaultMinutes={slots[0]?.durationMinutes ?? windows.find((w) => w.weekday === date.getDay())?.sessionMinutes ?? windows.find((w) => w.weekday === date.getDay())?.slotDurationMinutes ?? 60}
          openRanges={windows
            .filter((w) => w.weekday === date.getDay())
            .map((w) => ({ startMs: zonedTimeToUtc(params.date, w.startTime, timezone).getTime(), endMs: zonedTimeToUtc(params.date, w.endTime, timezone).getTime() }))}
          busyRanges={(bookingRows ?? []).map((b: any) => ({ startMs: new Date(b.start_at).getTime(), endMs: new Date(b.end_at).getTime() }))}
        />
      )}

      {/* Sessions at a time that is not one of the open slots (booked outside hours, or hours changed since) still need Mark attended
          and Cancel, so they get their own list instead of vanishing from this page. */}
      {otherBookings.length > 0 && (
        <div className="mt-6 max-w-lg">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Other sessions today</h2>
          <div className="divide-y divide-steel/15">
            {otherBookings.map((b: any) => {
              const start = new Date(b.start_at);
              return (
                <div key={b.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-body font-medium text-[15px]">{formatSlotTime(start, timezone)}</span>
                  {renderBooked(b, start)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </CoachDesktopShell>
  );
}
