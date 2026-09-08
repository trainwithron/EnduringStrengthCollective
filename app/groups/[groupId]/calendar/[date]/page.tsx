import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { generateSlotsForDate, formatSlotTime } from "@/lib/booking-slots";
import { getBlockedRangesForDate } from "@/lib/availability-exceptions";
import { AssignSlotButton } from "@/components/coach/desktop/assign-slot-button";
import { BookSlotButton } from "@/components/athlete/book-slot-button";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
import { RescheduleSlotButton } from "@/components/athlete/reschedule-slot-button";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { BuyCreditsButton } from "@/components/athlete/buy-credits-button";

export default async function CoachDayDetailPage({
  params,
  searchParams,
}: {
  params: { groupId: string; date: string };
  searchParams: { client?: string; reschedule?: string };
}) {
  const supabase = createServerClient();
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

  // An athlete booking with their coach — same logic as the program-scoped
  // day-detail page, just reachable at the group level so it works even
  // with no active program assigned (a client should always be able to
  // see and book their coach's open hours).
  if (membership.role === "athlete") {
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

      const { data: creditsRow } = await supabase
        .from("session_credits")
        .select("balance")
        .eq("athlete_id", user.id)
        .eq("group_id", params.groupId)
        .maybeSingle();
      creditBalance = creditsRow?.balance ?? 0;
    }

    const bookingByTime = new Map(
      bookingsForDay.map((b) => [new Date(b.start_at).getTime(), b])
    );
    const backHref = `/groups/${params.groupId}/calendar`;

    let reschedulingBooking: { id: string; start_at: string } | null = null;
    if (searchParams.reschedule) {
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
          {coachMembership && (
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

                    {isBeingRescheduled ? (
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
                          rescheduleHref={`${backHref}/${params.date}?reschedule=${booking.id}`}
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

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const date = new Date(`${params.date}T00:00:00`);
  const dayEnd = new Date(date);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const { data: windowRows } = await supabase
    .from("coach_availability_windows")
    .select("weekday, start_time, end_time, slot_duration_minutes")
    .eq("coach_id", user.id);

  const windows = (windowRows ?? []).map((w) => ({
    weekday: w.weekday,
    startTime: w.start_time,
    endTime: w.end_time,
    slotDurationMinutes: w.slot_duration_minutes,
  }));

  const blockedRanges = await getBlockedRangesForDate(supabase, user.id, date);
  const slots = generateSlotsForDate(date, windows, blockedRanges);

  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("id, start_at, athlete_id, profiles!bookings_athlete_id_fkey ( full_name )")
    .eq("coach_id", user.id)
    .eq("status", "confirmed")
    .gte("start_at", date.toISOString())
    .lt("start_at", dayEnd.toISOString());

  const bookingByTime = new Map(
    (bookingRows ?? []).map((b) => [new Date(b.start_at).getTime(), b as any])
  );

  // Selected client to assign into an open slot — carried via ?client= so
  // it survives the coach clicking through from either the client profile
  // or the main calendar's sidebar.
  const clientId = searchParams.client;
  let selectedClient: { fullName: string; balance: number } | null = null;

  if (clientId) {
    const { data: clientMembership } = await supabase
      .from("group_memberships")
      .select("profiles ( full_name )")
      .eq("group_id", params.groupId)
      .eq("profile_id", clientId)
      .eq("role", "athlete")
      .maybeSingle();

    if (clientMembership) {
      const { data: creditsRow } = await supabase
        .from("session_credits")
        .select("balance")
        .eq("athlete_id", clientId)
        .eq("group_id", params.groupId)
        .maybeSingle();

      selectedClient = {
        fullName: (clientMembership.profiles as any)?.full_name ?? "Client",
        balance: creditsRow?.balance ?? 0,
      };
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
                    <CancelBookingButton bookingId={booking.id} />
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
