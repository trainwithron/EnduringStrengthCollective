"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export const REFRESH_INTERVAL_MS = 120 * 1000;
// Never two refreshes within this long, whatever asks for them.
export const MIN_GAP_MS = 60 * 1000;
// Coming back to the tab refreshes only after it was hidden at least this long.
export const HIDDEN_AT_LEAST_MS = 60 * 1000;

// The Home dashboard's hero/flags/Team Pulse don't need real-time updates: a periodic refresh is fine (coach_dashboard_redesign_scoping.md). Every 2 minutes while the tab is in front, and once
// when the coach comes back to a tab that was hidden for a while.
//
// Oct 20 outage: this used to refresh on EVERY return to the tab. A browser pane that flips hidden/visible every few seconds (or a coach switching tabs a lot) re-rendered the whole Home each
// time, every ~5 s nonstop, and one open tab filled the database's connections. Now a return refreshes only after at least a minute away, and never more than once a minute in total
// (shared with the 2-minute timer). Pure rules below, tested with a flapping tab.
export function shouldRefreshOnTick(input: { now: number; lastRefreshAt: number; hidden: boolean; paused: boolean }): boolean {
  return !input.hidden && !input.paused && input.now - input.lastRefreshAt >= MIN_GAP_MS;
}

export function shouldRefreshOnReturn(input: { now: number; hiddenSince: number | null; lastRefreshAt: number; paused: boolean }): boolean {
  if (input.paused || input.hiddenSince === null) return false;
  return input.now - input.hiddenSince >= HIDDEN_AT_LEAST_MS && input.now - input.lastRefreshAt >= MIN_GAP_MS;
}

export function DashboardAutoRefresh({ paused = false }: { paused?: boolean }) {
  const router = useRouter();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    // The page was just rendered: that counts as a refresh.
    let lastRefreshAt = Date.now();
    let hiddenSince: number | null = document.hidden ? Date.now() : null;
    const refresh = () => {
      lastRefreshAt = Date.now();
      router.refresh();
    };

    const interval = setInterval(() => {
      if (shouldRefreshOnTick({ now: Date.now(), lastRefreshAt, hidden: document.hidden, paused: pausedRef.current })) refresh();
    }, REFRESH_INTERVAL_MS);

    function handleVisibility() {
      if (document.hidden) {
        if (hiddenSince === null) hiddenSince = Date.now();
        return;
      }
      const away = hiddenSince;
      hiddenSince = null;
      if (shouldRefreshOnReturn({ now: Date.now(), hiddenSince: away, lastRefreshAt, paused: pausedRef.current })) refresh();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [router]);

  return null;
}
