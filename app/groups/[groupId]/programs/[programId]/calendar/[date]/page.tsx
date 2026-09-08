import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { generateSlotsForDate, formatSlotTime } from "@/lib/booking-slots";
import { BookSlotButton } from "@/components/athlete/book-slot-button";
import { CancelBookingButton } from "@/components/athlete/cancel-booking-button";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { BuyCreditsButton } from "@/components/athlete/buy-credits-button";

export default async function DayDetailPage({
  params,
}: {
  params: { groupId: string; programId: string; date: string };
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

    slots = generateSlotsForDate(date, windows);

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
            {creditBalance <= 0 && (
              <div className="mt-2">
                <BuyCreditsButton groupId={params.groupId} />
              </div>
            )}
          </div>
        )}
      </header>

      <section className="px-5 pt-6">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">
          Open sessions
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
                  ) : booking ? (
                    isMine ? (
                      <CancelBookingButton bookingId={booking.id} />
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
