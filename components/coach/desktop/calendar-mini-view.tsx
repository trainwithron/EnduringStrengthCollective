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
// — this doesn't try to replicate the full month grid's drag-and-drop/
// booking flows at 220-560px wide.
//
// Real usability feedback from Ron: a fixed 7-day window showed an empty
// "nothing booked" card on a genuinely quiet week even when real bookings
// existed further out — not useful. Cascading zoom instead: day view by
// default (today's real bookings), falling back to week (next 7 days),
// falling back to month (next 30) only when the narrower window is
// actually empty — "zoom out until something's actually there to show,"
// not a fixed window that can render empty while real data exists.
type ZoomLevel = "day" | "week" | "month";
const ZOOM_LABEL: Record<ZoomLevel, string> = { day: "Today", week: "This week", month: "This month" };

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
      const monthOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const { data } = await supabase
        .from("bookings")
        .select("id, start_at, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("status", "confirmed")
        .gte("start_at", now.toISOString())
        .lte("start_at", monthOut.toISOString())
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
  const now = new Date();
  const weekOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const dayBookings = bookings.filter((b) => dateKey(new Date(b.startAt)) === todayKey);
  const weekBookings = bookings.filter((b) => new Date(b.startAt) <= weekOut);

  let zoomLevel: ZoomLevel;
  let visibleBookings: MiniBooking[];
  if (dayBookings.length > 0) {
    zoomLevel = "day";
    visibleBookings = dayBookings;
  } else if (weekBookings.length > 0) {
    zoomLevel = "week";
    visibleBookings = weekBookings;
  } else {
    zoomLevel = "month";
    visibleBookings = bookings;
  }

  return (
    <div>
      <Link
        href={`/groups/${groupId}/calendar`}
        className="block font-body text-xs text-rust px-1 mb-2"
      >
        Open full calendar &rarr;
      </Link>
      {visibleBookings.length === 0 ? (
        <p className="font-body text-xs text-steel px-1">Nothing booked in the next 30 days.</p>
      ) : (
        <div className="space-y-0.5">
          <p className="font-body text-[10px] text-steel uppercase tracking-wide px-1.5 mb-1">
            {ZOOM_LABEL[zoomLevel]}
          </p>
          {visibleBookings.map((b) => {
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
