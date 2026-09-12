"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

export type CalendarViewMode = "day" | "week" | "month";

const STORAGE_KEY = "home-calendar-view-mode";

// View mode (Day/Week/Month) is a real remembered preference; the
// selected DATE never is — every fresh Home load resets to today's Day
// view regardless of what was last browsed. See
// [[athlete_home_calendar_redesign]] rule #2.
export function readViewMode(): CalendarViewMode {
  if (typeof window === "undefined") return "day";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "week" || stored === "month" ? stored : "day";
  } catch {
    return "day";
  }
}

function writeViewMode(mode: CalendarViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private browsing / storage blocked — the toggle still works for
    // the rest of this visit, it just won't persist across reloads.
  }
}

// Redirects a fresh Home load (no explicit ?view=) to the remembered
// preference. A brief Day-view flash before the redirect is an accepted
// trade-off — the alternative is a server-side cookie read for what's
// deliberately a client-only, per-browser preference (see
// lib/card-size.ts's identical localStorage-only convention).
export function ViewModeRedirector({ hasViewParam }: { hasViewParam: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (hasViewParam) return;
    const stored = readViewMode();
    if (stored === "week") router.replace("?view=week");
    else if (stored === "month") router.replace("?view=month");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export function DayWeekMonthSwitcher({ groupId }: { groupId: string }) {
  const searchParams = useSearchParams();
  const active = (searchParams.get("view") as CalendarViewMode | null) ?? "day";

  const tabs: { key: CalendarViewMode; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "week", label: "Week" },
    { key: "month", label: "Month" },
  ];

  return (
    <div className="flex items-center gap-1 mb-3">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.key === "day" ? `/groups/${groupId}` : `/groups/${groupId}?view=${tab.key}`}
          onClick={() => writeViewMode(tab.key)}
          className={`h-8 px-3 flex items-center font-body text-xs border ${
            active === tab.key
              ? "bg-rust text-graphite border-rust"
              : "border-steel/30 text-steel active:border-rust active:text-rust"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
