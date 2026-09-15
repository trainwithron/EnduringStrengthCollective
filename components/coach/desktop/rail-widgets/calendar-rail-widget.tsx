"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { RailWidgetHeader, RailWidgetRow, RailWidgetDeeperLink, RailWidgetEmpty, RailWidgetLoading } from "./rail-widget-shell";

interface TodayBooking {
  id: string;
  startAt: string;
  athleteName: string;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Hover rail widgets (hover_expand_rail_widgets_idea.md) — Calendar icon.
// Same `bookings` table/columns/status filter as calendar-mini-view.tsx
// (the list panel's own Calendar view) — scoped to today only, matching
// the mockup's "1:00, 3:00, 8:00" — kept clean, not the full 7-day list
// that view already shows elsewhere.
export function CalendarRailWidget({ groupId }: { groupId: string }) {
  const [bookings, setBookings] = useState<TodayBooking[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

      const { data } = await supabase
        .from("bookings")
        .select("id, start_at, profiles!bookings_athlete_id_fkey ( full_name )")
        .eq("coach_id", user.id)
        .eq("status", "confirmed")
        .gte("start_at", startOfDay.toISOString())
        .lt("start_at", endOfDay.toISOString())
        .order("start_at", { ascending: true });

      if (!cancelled) {
        setBookings(
          (data ?? []).map((b: any) => ({ id: b.id, startAt: b.start_at, athleteName: b.profiles?.full_name ?? "Client" }))
        );
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const todayHref = `/groups/${groupId}/calendar/${dateKey(new Date())}`;

  return (
    <div>
      <RailWidgetHeader title="Today" />
      {bookings === null ? (
        <RailWidgetLoading />
      ) : bookings.length === 0 ? (
        <RailWidgetEmpty text="Nothing booked today." />
      ) : (
        <div>
          {bookings.map((b) => (
            <RailWidgetRow
              key={b.id}
              primary={b.athleteName}
              secondary={new Date(b.startAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              href={todayHref}
            />
          ))}
        </div>
      )}
      <RailWidgetDeeperLink href={`/groups/${groupId}/calendar`} label="Open Calendar" />
    </div>
  );
}
