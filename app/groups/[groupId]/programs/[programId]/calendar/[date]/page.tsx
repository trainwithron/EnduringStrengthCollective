import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { generateSlotsForDate, formatSlotTime, minimumNoticeBlockedRange, isSlotBufferBlocked } from "@/lib/booking-slots";
import { expiryWindowLine } from "@/lib/expiry-checkin";
import { creditExpiryDate } from "@/lib/credit-expiration";
import { getBlockedRangesForDate } from "@/lib/availability-exceptions";
import { zonedTimeToUtc, DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { BookSlotButton } from "@/components/athlete/book-slot-button";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
import { RescheduleSlotButton } from "@/components/athlete/reschedule-slot-button";
import { RequestSlotButton } from "@/components/athlete/request-slot-button";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { TodayWidget } from "@/components/athlete/today-widget";
import { DayMealsView } from "@/components/athlete/day-meals-view";
import { computeScheduledDates } from "@/lib/program-schedule";
import { isHabitDueOn } from "@/lib/habits";
import { resolveDayMacros, standingForDate } from "@/lib/macro-resolution";
import { fetchStandingHistory } from "@/lib/standing-macros";
import { CalendarPurchasePrompt } from "@/components/athlete/calendar-purchase-prompt";
import { isStripeConfigured } from "@/lib/stripe";
import type { PackageOption } from "@/components/athlete/package-picker";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { WaitlistJoinButton } from "@/components/athlete/waitlist-join-button";
import { RecurringBookingButton } from "@/components/athlete/recurring-booking-button";
import { RecurringConflictBadge } from "@/components/coach/desktop/recurring-conflict-badge";
import { sessionBalanceLine, NO_SESSIONS_SLOT_LABEL } from "@/lib/session-credit-copy";

export default async function DayDetailPage(
  props: {
    params: Promise<{ groupId: string; programId: string; date: string }>;
    searchParams: Promise<{ reschedule?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const backHref = `/groups/${params.groupId}/programs/${params.programId}/calendar`;

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
      <NoAccess>This program isn&apos;t available, or you don&apos;t have access to it.</NoAccess>
    );
  }

  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", params.groupId)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  // A coach "acting as" a client sees exactly what that client would see
  // here — every `membership.role === "athlete"` gate below also opens for
  // an impersonated session, keyed off the resolved athlete id. The
  // coach-only "Booked — {name} / Open" status line stays real-coach-only.
  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const isActingAsOther = effective.isActingAsOther;
  const athleteId = effective.athleteId;
  const viewingAsAthlete = membership.role === "athlete" || isActingAsOther;

  let actingAsFullName: string | null = null;
  if (isActingAsOther) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", athleteId)
      .maybeSingle();
    actingAsFullName = profile?.full_name ?? "Client";
  }

  const date = new Date(`${params.date}T00:00:00`);

  // Everything actually assigned to this athlete for this specific date —
  // an explicit workout override always wins over the program's computed
  // default, same precedence lib/todays-workout.ts already uses.
  let dayWorkout: { id: string; title: string } | null = null;
  let dayMacros: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null = null;
  let dayHabits: { id: string; title: string; completed: boolean }[] = [];
  let dayMeals: Record<string, any[]> | null = null;
  let pinnedLinks: { id: string; title: string; url: string }[] = [];

  if (viewingAsAthlete) {
    const { data: assignment } = await supabase
      .from("workout_assignments")
      .select("workouts ( id, title )")
      .eq("athlete_id", athleteId)
      .eq("scheduled_date", params.date)
      .maybeSingle();

    if (assignment?.workouts) {
      dayWorkout = assignment.workouts as any;
    } else {
      const { data: program } = await supabase
        .from("programs")
        .select("id, start_date, training_days")
        .eq("id", params.programId)
        .maybeSingle();
      if (program?.start_date && program.training_days?.length) {
        const { data: workouts } = await supabase
          .from("workouts")
          .select("id, title, week_number, day_index, scheduled_date")
          .eq("program_id", program.id)
          .order("week_number", { ascending: true })
          .order("day_index", { ascending: true });
        if (workouts) {
          const scheduledDateByDayId = computeScheduledDates(
            program.start_date,
            program.training_days,
            workouts.map((w) => ({ id: w.id, scheduledDate: w.scheduled_date }))
          );
          for (const w of workouts) {
            const d = scheduledDateByDayId.get(w.id);
            if (d && d.toISOString().slice(0, 10) === params.date) {
              dayWorkout = { id: w.id, title: w.title };
              break;
            }
          }
        }
      }
    }

    const { data: membershipTier } = await supabase
      .from("group_memberships")
      .select("client_tier")
      .eq("group_id", params.groupId)
      .eq("profile_id", athleteId)
      .maybeSingle();
    const macrosEnabled = membershipTier?.client_tier !== "group";

    if (macrosEnabled) {
      const { data: macrosRow } = await supabase
        .from("daily_macros")
        .select("calories, protein_g, carbs_g, fat_g")
        .eq("athlete_id", athleteId)
        .eq("log_date", params.date)
        .maybeSingle();

      const { data: mealPlanRow } = await supabase
        .from("meal_plans")
        .select("meals, macros")
        .eq("athlete_id", athleteId)
        .eq("log_date", params.date)
        .maybeSingle();
      dayMeals = (mealPlanRow?.meals as any) ?? null;

      // A day's meal plan carries its own macros, computed for the exact
      // meals shown below — that target wins over daily_macros when both
      // exist, so the number here never contradicts what's actually
      // assigned. See lib/todays-macros.ts.
      dayMacros = resolveDayMacros(
        macrosRow ?? null,
        mealPlanRow?.macros ?? null,
        dayMeals,
        standingForDate(await fetchStandingHistory(supabase, athleteId), params.date)
      ).target;
    }

    const { data: habitDefs } = await supabase
      .from("client_habits")
      .select("id, title, weekdays")
      .eq("athlete_id", athleteId)
      .eq("group_id", params.groupId)
      .eq("active", true);
    const dueHabitDefs = (habitDefs ?? []).filter((h) => isHabitDueOn(h.weekdays, date));

    const { data: habitLogRows } = await supabase
      .from("habit_logs")
      .select("habit_id, completed_at")
      .in("habit_id", dueHabitDefs.map((h) => h.id))
      .eq("log_date", params.date);
    const completedIds = new Set(
      (habitLogRows ?? []).filter((l) => l.completed_at).map((l) => l.habit_id)
    );
    dayHabits = dueHabitDefs.map((h) => ({ id: h.id, title: h.title, completed: completedIds.has(h.id) }));
  }

  // coach_identity_bio_social_link_pinning_scoping_sept19.md — a Pro
  // Shop link the coach pinned to this exact athlete+date.
  const { data: dayPinRows } = await supabase
    .from("pro_shop_link_day_pins")
    .select("id, pro_shop_links ( id, title, url )")
    .eq("athlete_id", athleteId)
    .eq("pin_date", params.date);
  pinnedLinks = (dayPinRows ?? [])
    .map((p: any) => (p.pro_shop_links ? { id: p.pro_shop_links.id as string, title: p.pro_shop_links.title as string, url: p.pro_shop_links.url as string } : null))
    .filter((l): l is { id: string; title: string; url: string } => l != null);

  let slots: { start: Date; durationMinutes: number }[] = [];
  let bookingsForDay: any[] = [];
  let creditBalance = 0;
  let creditExpiresAt: Date | null = null;
  let creditExpiryDaysForNote = 0;
  let activeSubscription: { currentPeriodEnd: string | null } | null = null;
  let availablePackages: PackageOption[] = [];
  let bufferBlockingBookings: { id: string; start: Date; end: Date }[] = [];
  let resolvedBufferMinutes = 0;
  let waitlistStatusByTime = new Map<number, "waiting" | "offered">();
  let timezone: string = DEFAULT_COACH_TIMEZONE;

  if (coachMembership) {
    const { data: coachProfile } = await supabase
      .from("profiles")
      .select("timezone")
      .eq("id", coachMembership.profile_id)
      .maybeSingle();
    timezone = coachProfile?.timezone ?? DEFAULT_COACH_TIMEZONE;

    const { data: windowRows } = await supabase
      .from("coach_availability_windows")
      .select("weekday, start_time, end_time, slot_duration_minutes")
      .eq("coach_id", coachMembership.profile_id);

    const windows = (windowRows ?? []).map((w) => ({
      weekday: w.weekday,
      startTime: w.start_time,
      endTime: w.end_time,
      slotDurationMinutes: w.slot_duration_minutes,
    }));

    const { data: policyRow } = await supabase
      .from("coach_booking_policies")
      .select("buffer_minutes, minimum_notice_hours, credit_expiry_days")
      .eq("coach_id", coachMembership.profile_id)
      .maybeSingle();
    resolvedBufferMinutes = policyRow?.buffer_minutes ?? 0;

    const blockedRangesFromExceptions = await getBlockedRangesForDate(
      supabase,
      coachMembership.profile_id,
      date,
      timezone
    );
    // Minimum notice only applies to an athlete booking for themselves —
    // never to the coach's own scheduling view (matches book_session's
    // v_is_self gate), so it's excluded from the shared slot list unless
    // the current viewer is genuinely the athlete.
    const noticeRange = viewingAsAthlete
      ? minimumNoticeBlockedRange(new Date(), policyRow?.minimum_notice_hours ?? 0)
      : null;
    const blockedRanges = noticeRange ? [...blockedRangesFromExceptions, noticeRange] : blockedRangesFromExceptions;
    slots = generateSlotsForDate(date, windows, blockedRanges, timezone);

    // Bounded in the coach's own zone, not naive UTC midnight — a late-
    // evening booking in a zone well behind UTC can otherwise fall on the
    // "wrong" UTC calendar day and get missed by this filter.
    const zonedDayStart = zonedTimeToUtc(params.date, "00:00", timezone);
    const zonedDayEnd = new Date(zonedDayStart.getTime() + 24 * 60 * 60 * 1000);

    const { data: bookingRows } = await supabase
      .from("bookings")
      .select(
        "id, start_at, end_at, athlete_id, needs_coach_resolution, recurring_series_id, profiles!bookings_athlete_id_fkey ( full_name )"
      )
      .eq("coach_id", coachMembership.profile_id)
      .eq("status", "confirmed")
      .gte("start_at", zonedDayStart.toISOString())
      .lt("start_at", zonedDayEnd.toISOString());

    bookingsForDay = bookingRows ?? [];
    bufferBlockingBookings = bookingsForDay.map((b) => ({
      id: b.id as string,
      start: new Date(b.start_at as string),
      end: new Date(b.end_at as string),
    }));

    if (viewingAsAthlete) {
      const { data: creditsRow } = await supabase
        .from("session_credits")
        .select("balance, last_granted_at")
        .eq("athlete_id", athleteId)
        .eq("group_id", params.groupId)
        .maybeSingle();
      creditBalance = creditsRow?.balance ?? 0;
      creditExpiresAt = creditExpiryDate(creditsRow?.last_granted_at ?? null, policyRow?.credit_expiry_days ?? 0);
      creditExpiryDaysForNote = policyRow?.credit_expiry_days ?? 0;

      const { data: waitlistRows } = await supabase
        .from("booking_waitlist_entries")
        .select("slot_start_at, status")
        .eq("athlete_id", athleteId)
        .eq("coach_id", coachMembership.profile_id)
        .in("status", ["waiting", "offered"]);
      waitlistStatusByTime = new Map(
        (waitlistRows ?? []).map((w) => [new Date(w.slot_start_at).getTime(), w.status as "waiting" | "offered"])
      );

      const { data: subscriptionRow } = await supabase
        .from("membership_subscriptions")
        .select("current_period_end")
        .eq("athlete_id", athleteId)
        .eq("group_id", params.groupId)
        .eq("status", "active")
        .maybeSingle();
      activeSubscription = subscriptionRow
        ? { currentPeriodEnd: subscriptionRow.current_period_end }
        : null;

      const { data: packageRows } = await supabase
        .from("coach_packages")
        .select("id, name, sessions_per_week, billing_type, sessions_granted, rate_cents")
        .eq("group_id", params.groupId)
        .eq("is_active", true)
        .order("sessions_per_week", { ascending: true });
      availablePackages = (packageRows ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        sessionsPerWeek: p.sessions_per_week,
        billingType: p.billing_type as "subscription" | "one_time",
        sessionsGranted: p.sessions_granted,
        rateCents: p.rate_cents,
      }));
    }
  }

  // Keyed by numeric timestamp, not the raw string — Postgres and the JS
  // Date constructor don't format timestamptz identically (fractional
  // seconds, offset notation), so a raw string-equality lookup silently
  // misses real matches.
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
  if (bookingMode === "request") {
    const { data: pendingRows } = await supabase
      .from("booking_requests")
      .select("new_start_at")
      .eq("athlete_id", athleteId)
      .eq("status", "pending");
    for (const r of pendingRows ?? []) requestedTimes.add(new Date(r.new_start_at as string).getTime());
  }

  // A ?reschedule=<bookingId> in the URL means the athlete is moving an
  // existing booking here rather than spending a new credit — validated
  // server-side (must be their own, still confirmed) before any slot is
  // offered as a destination.
  let reschedulingBooking: { id: string; start_at: string } | null = null;
  if (viewingAsAthlete && searchParams.reschedule) {
    const { data: rb } = await supabase
      .from("bookings")
      .select("id, start_at")
      .eq("id", searchParams.reschedule)
      .eq("athlete_id", athleteId)
      .eq("status", "confirmed")
      .maybeSingle();
    reschedulingBooking = rb;
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back to calendar
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">
          {date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </h1>
        {viewingAsAthlete && coachMembership && (
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

      {viewingAsAthlete && (dayWorkout || dayMacros || dayHabits.length > 0 || dayMeals) && (
        <section className="px-5 pt-6 space-y-4">
          {dayWorkout && (
            <div className="border border-steel/20 p-4">
              <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
                Workout
              </h2>
              <Link
                href={`/groups/${params.groupId}/workouts/${dayWorkout.id}`}
                className="font-body text-sm text-rust"
              >
                {dayWorkout.title} &rarr;
              </Link>
            </div>
          )}
          <TodayWidget todayDate={params.date} macros={dayMacros} habits={dayHabits} pinnedLinks={pinnedLinks} />
          <DayMealsView meals={dayMeals} />
        </section>
      )}

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
              // buffer-blocked) slot doesn't invite a click the RPC
              // would just reject.
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
                    {formatSlotTime(start, timezone)}
                  </span>

                  {membership.role === "coach" && !isActingAsOther ? (
                    <span className="font-body text-xs text-steel flex items-center gap-1.5">
                      {booking
                        ? `Booked — ${(booking.profiles as any)?.full_name ?? "Client"}`
                        : "Open"}
                      {booking?.needs_coach_resolution && <RecurringConflictBadge bookingId={booking.id} />}
                    </span>
                  ) : isBeingRescheduled ? (
                    <span className="font-body text-xs text-steel">Currently here</span>
                  ) : reschedulingBooking ? (
                    booking ? (
                      <span className="font-body text-xs text-steel">Booked</span>
                    ) : isBufferBlocked ? (
                      <span className="font-body text-xs text-steel">Too close to another session</span>
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
                      <CancelBookingButton
                        bookingId={booking.id}
                        rescheduleHref={`${backHref}?reschedule=${booking.id}`}
                        recurringSeriesId={booking.recurring_series_id}
                      />
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
                    <span className="font-body text-xs text-steel">Too close to another session</span>
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
      </section>

      {viewingAsAthlete && (
        <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
      )}
    </main>
  );
}
