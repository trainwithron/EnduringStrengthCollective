"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 45 * 1000;

// The Home dashboard's hero/flags/Team Pulse don't need true real-time
// updates — a periodic refresh is explicitly fine
// (coach_dashboard_redesign_scoping.md), reusing the same no-UI interval
// pattern already proven by Weight-Room Display Mode's
// display-auto-refresh.tsx, just a much shorter interval (45s vs. 5min)
// and two refinements that component didn't need: paused while the tab
// is hidden (resume immediately on refocus — no point refetching data
// nobody's looking at), and pausable mid-interaction once the
// customization layer (drag-to-reorder, an open metric-peek bubble)
// exists — the `paused` prop is wired for that now even though nothing
// sets it true yet.
export function DashboardAutoRefresh({ paused = false }: { paused?: boolean }) {
  const router = useRouter();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const interval = setInterval(() => {
      if (pausedRef.current) return;
      if (document.hidden) return;
      router.refresh();
    }, REFRESH_INTERVAL_MS);

    function handleVisibility() {
      if (!document.hidden && !pausedRef.current) {
        router.refresh();
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [router]);

  return null;
}
