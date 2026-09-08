import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { generateSlotsForDate, formatSlotTime } from "@/lib/booking-slots";
import { getBlockedRangesForDate } from "@/lib/availability-exceptions";
import { BookSlotButton } from "@/components/athlete/book-slot-button";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
import { RescheduleSlotButton } from "@/components/athlete/reschedule-slot-button";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { BuyCreditsButton } from "@/components/athlete/buy-credits-button";
import { TodayWidget } from "@/components/athlete/today-widget";
import { DayMealsView } from "@/components/athlete/day-meals-view";
import { computeScheduledDates } from "@/lib/program-schedule";
import { isHabitDueOn } from "@/lib/habits";

export default async function DayDetailPage({
  params,
  searchParams,
}: {
  params: { groupId: string; programId: string; date: string };
  searchParams: { reschedule?: string };
}) {
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const backHref = `/groups/${params.groupId}/programs/${params.programId}/calendar`;

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
          This program isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", params.groupId)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();

  const date = new Date(`${params.date}T00:00:00`);
  const dayEnd = new Date(date);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // Everything actually assigned to this athlete for this specific date —
  // an explicit workout override always wins over the program's computed
  // default, same precedence lib/todays-workout.ts already uses.
  let dayWorkout: { id: string; title: string } | null = null;
  let dayMacros: { calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null } | null = null;
  let dayHabits: { id: string; title: string; completed: boolean }[] = [];
  let dayMeals: Record<string, any[]> | null = null;

  if (membership.role === "athlete") {
    const { data: assignment } = await supabase
      .from("workout_assignments")
      .select("workouts ( id, title )")
      .eq("athlete_id", user.id)
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
          .select("id, title, week_number, day_index")
          .eq("program_id", program.id)
          .order("week_number", { ascending: true })
          .order("day_index", { ascending: true });
        if (workouts) {
          const scheduledDateByDayId = computeScheduledDates(program.start_date, program.training_days, workouts);
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
      .eq("profile_id", user.id)
      .maybeSingle();
    const macrosEnabled = membershipTier?.client_tier !== "group";

    if (macrosEnabled) {
      const { data: macrosRow } = await supabase
        .from("daily_macros")
        .select("calories, protein_g, carbs_g, fat_g")
        .eq("athlete_id", user.id)
        .eq("log_date", params.date)
        .maybeSingle();
      if (macrosRow) {
        dayMacros = {
          calories: macrosRow.calories,
          proteinG: macrosRow.protein_g,
          carbsG: macrosRow.carbs_g,
          fatG: macrosRow.fat_g,
        };
      }

      const { data: mealPlanRow } = await supabase
        .from("meal_plans")
        .select("meals")
        .eq("athlete_id", user.id)
        .eq("log_date", params.date)
        .maybeSingle();
      dayMeals = (mealPlanRow?.meals as any) ?? null;
    }

    const { data: habitDefs } = await supabase
      .from("client_habits")
      .select("id, title, weekdays")
      .eq("athlete_id", user.id)
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

  let slots: { start: Date; durationMinutes: number }[] = [];
  let bookingsForDay: any[] = [];
  let creditBalance = 0;

  if (coachMembership) {
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

    const blockedRanges = await getBlockedRangesForDate(supabase, coachMembership.profile_id, date);
    slots = generateSlotsForDate(date, windows, blockedRanges);

    const { data: bookingRows } = await supabase
      .from("bookings")
      .select("id, start_at, athlete_id, profiles!bookings_athlete_id_fkey ( full_name )")
      .eq("coach_id", coachMembership.profile_id)
      .eq("status", "confirmed")
      .gte("start_at", date.toISOString())
      .lt("start_at", dayEnd.toISOString());

    bookingsForDay = bookingRows ?? [];

    if (membership.role === "athlete") {
      const { data: creditsRow } = await supabase
        .from("session_credits")
        .select("balance")
        .eq("athlete_id", user.id)
        .eq("group_id", params.groupId)
        .maybeSingle();
      creditBalance = creditsRow?.balance ?? 0;
    }
  }

  // Keyed by numeric timestamp, not the raw string — Postgres and the JS
  // Date constructor don't format timestamptz identically (fractional
  // seconds, offset notation), so a raw string-equality lookup silently
  // misses real matches.
  const bookingByTime = new Map(
    bookingsForDay.map((b) => [new Date(b.start_at).getTime(), b])
  );

  // A ?reschedule=<bookingId> in the URL means the athlete is moving an
  // existing booking here rather than spending a new credit — validated
  // server-side (must be their own, still confirmed) before any slot is
  // offered as a destination.
  let reschedulingBooking: { id: string; start_at: string } | null = null;
  if (membership.role === "athlete" && searchParams.reschedule) {
    const { data: rb } = await supabase
      .from("bookings")
      .select("id, start_at")
      .eq("id", searchParams.reschedule)
      .eq("athlete_id", user.id)
      .eq("status", "confirmed")
      .maybeSingle();
    reschedulingBooking = rb;
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
          &larr; Back to calendar
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">
          {date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </h1>
        {membership.role === "athlete" && coachMembership && (
          <div className="mt-3">
            <p className="font-body text-xs text-steel">
              Session credits available: {creditBalance}
            </p>
            {creditBalance <= 0 && !reschedulingBooking && (
              <div className="mt-2">
                <BuyCreditsButton groupId={params.groupId} />
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

      {membership.role === "athlete" && (dayWorkout || dayMacros || dayHabits.length > 0 || dayMeals) && (
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
          <TodayWidget todayDate={params.date} macros={dayMacros} habits={dayHabits} />
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
          <p className="font-body text-sm text-steel py-2">No open hours on this day.</p>
        ) : (
          <div className="divide-y divide-steel/15">
            {slots.map(({ start, durationMinutes }) => {
              const iso = start.toISOString();
              const booking = bookingByTime.get(start.getTime());
              const isMine = booking?.athlete_id === user.id;
              const isBeingRescheduled = booking?.id === reschedulingBooking?.id;
              const endAt = new Date(start.getTime() + durationMinutes * 60000);

              return (
                <div key={iso} className="py-3 flex items-center justify-between">
                  <span className="font-body font-medium text-[15px]">
                    {formatSlotTime(start)}
                  </span>

                  {membership.role === "coach" ? (
                    <span className="font-body text-xs text-steel">
                      {booking
                        ? `Booked — ${(booking.profiles as any)?.full_name ?? "Client"}`
                        : "Open"}
                    </span>
                  ) : isBeingRescheduled ? (
                    <span className="font-body text-xs text-steel">Currently here</span>
                  ) : reschedulingBooking ? (
                    booking ? (
                      <span className="font-body text-xs text-steel">Booked</span>
                    ) : (
                      <RescheduleSlotButton
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
                      />
                    ) : (
                      <span className="font-body text-xs text-steel">Booked</span>
                    )
                  ) : creditBalance > 0 ? (
                    <BookSlotButton
                      coachId={coachMembership.profile_id}
                      athleteId={user.id}
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

      {membership.role === "athlete" && (
        <BottomTabBar groupId={params.groupId} activeOverride="calendar" />
      )}
    </main>
  );
}
