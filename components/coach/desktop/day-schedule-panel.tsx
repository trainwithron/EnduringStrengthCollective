"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

interface DayBooking {
  athleteName: string;
  startAt: string;
}

// Lazily fetches the coach's own schedule for one specific date — real
// bookings across every client, plus recurring availability for that
// weekday — only once a calendar day is actually expanded. Keeping this
// out of the month page's own server-side fetch avoids pulling booking/
// availability detail for every day in the month up front for a panel
// most days never open.
export function DaySchedulePanel({ date }: { date: string }) {
  const [bookings, setBookings] = useState<DayBooking[] | null>(null);
  const [availability, setAvailability] = useState<{ startTime: string; endTime: string }[] | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const weekday = new Date(`${date}T00:00:00`).getDay();

      const [{ data: bookingRows }, { data: availabilityRows }] = await Promise.all([
        supabase
          .from("bookings")
          .select("start_at, profiles ( full_name )")
          .eq("coach_id", user.id)
          .eq("status", "confirmed")
          .gte("start_at", `${date}T00:00:00`)
          .lt("start_at", `${date}T23:59:59.999`)
          .order("start_at", { ascending: true }),
        supabase
          .from("coach_availability_windows")
          .select("start_time, end_time")
          .eq("coach_id", user.id)
          .eq("weekday", weekday)
          .order("start_time", { ascending: true }),
      ]);

      if (cancelled) return;
      setBookings(
        (bookingRows ?? []).map((b: any) => ({
          athleteName: b.profiles?.full_name ?? "A client",
          startAt: b.start_at,
        }))
      );
      setAvailability(
        (availabilityRows ?? []).map((w) => ({ startTime: w.start_time, endTime: w.end_time }))
      );
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (bookings === null || availability === null) {
    return <p className="font-body text-xs text-steel">Loading…</p>;
  }

  return (
    <div>
      {availability.length > 0 && (
        <div className="mb-3">
          <p className="font-body text-[11px] text-steel uppercase tracking-wide mb-1">
            Recurring availability
          </p>
          <div className="flex flex-wrap gap-2">
            {availability.map((w, i) => (
              <span key={i} className="font-body text-xs text-chalk border border-steel/30 px-2 py-1">
                {w.startTime.slice(0, 5)}–{w.endTime.slice(0, 5)}
              </span>
            ))}
          </div>
        </div>
      )}
      {bookings.length > 0 ? (
        <div className="divide-y divide-steel/15">
          {bookings.map((b, i) => (
            <div key={i} className="py-2 flex items-center justify-between">
              <span className="font-body text-sm">{b.athleteName}</span>
              <span className="font-body text-xs text-steel">
                {new Date(b.startAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="font-body text-sm text-steel">No booked sessions this day.</p>
      )}
    </div>
  );
}
