"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserClient } from "@/lib/supabase/client";

interface MiniBooking {
  id: string;
  startAt: string;
  athleteName: string;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// calendar_workout_scheduling_and_adjustable_workspace_idea.md item 4 —
// one of the panel's now-configurable views. Same "glance here, go
// deeper on the real page" split as RosterMiniList/BusinessMiniDashboard
// — this shows the coach's next 7 days of confirmed sessions, it
// doesn't try to replicate the full month grid's drag-and-drop/booking
// flows at 220-560px wide.
export function CalendarMiniView({ groupId }: { groupId: string }) {
  const [bookings, setBookings] = useState<MiniBooking[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const now = new Date();
      const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { data } = await supabase
        .from("bookings")
        .select("id, start_at, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("status", "confirmed")
        .gte("start_at", now.toISOString())
        .lte("start_at", weekOut.toISOString())
        .order("start_at", { ascending: true });

      if (!cancelled) {
        setBookings(
          (data ?? []).map((b: any) => ({
            id: b.id,
            startAt: b.start_at,
            athleteName: b.profiles?.full_name ?? "Client",
          }))
        );
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (bookings === null) {
    return <p className="font-body text-xs text-steel px-1">Loading…</p>;
  }

  const todayKey = dateKey(new Date());

  return (
    <div>
      <Link
        href={`/groups/${groupId}/calendar`}
        className="block font-body text-xs text-rust px-1 mb-2"
      >
        Open full calendar &rarr;
      </Link>
      {bookings.length === 0 ? (
        <p className="font-body text-xs text-steel px-1">Nothing booked in the next 7 days.</p>
      ) : (
        <div className="space-y-0.5">
          {bookings.map((b) => {
            const start = new Date(b.startAt);
            const isToday = dateKey(start) === todayKey;
            return (
              <Link
                key={b.id}
                href={`/groups/${groupId}/calendar/${dateKey(start)}`}
                className="flex items-center justify-between gap-2 px-1.5 py-2 hover:bg-surface/40 transition-colors"
              >
                <span className="font-body text-sm text-chalk truncate">{b.athleteName}</span>
                <span className={`font-body text-[11px] shrink-0 ${isToday ? "text-rust" : "text-steel"}`}>
                  {isToday
                    ? start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                    : start.toLocaleDateString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
