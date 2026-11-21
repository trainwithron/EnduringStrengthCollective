"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { calendarViewAction, readCalendarView, writeCalendarView, type CalendarView } from "@/lib/calendar-view-memory";

// Draws nothing: remembers the view the coach picked, and on a bare open switches to Week when that was their last view (lib/calendar-view-memory.ts).
export function CalendarViewMemory({ view, explicit }: { view: CalendarView; explicit: boolean }) {
  const router = useRouter();
  useEffect(() => {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      return;
    }
    const action = calendarViewAction(readCalendarView(storage), view, explicit);
    if (action === "remember") writeCalendarView(storage, view);
    if (action === "open-week") {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("view", "week");
        router.replace(`${url.pathname}${url.search}`, { scroll: false });
      } catch {
        // stays on Month
      }
    }
  }, [view, explicit, router]);
  return null;
}
