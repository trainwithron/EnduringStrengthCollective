"use client";

import { useEffect } from "react";

// The waiting-requests number on the installed app's icon (Ron, Nov 20, wave 3 C10). Where the device supports app badges (an installed app on most phones and desktops), the icon
// shows how many requests are waiting on the coach's answer, and nothing when there are none. Anywhere else this does nothing. Checked when a coach page opens, when the app comes
// back to the front, and every five minutes while it is open. Draws nothing.
const EVERY_MS = 5 * 60 * 1000;

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export function applyAppBadge(nav: BadgeNavigator | undefined, count: number | null): void {
  if (!nav || typeof nav.setAppBadge !== "function" || count === null) return;
  if (count > 0) void nav.setAppBadge(count).catch(() => {});
  else if (typeof nav.clearAppBadge === "function") void nav.clearAppBadge().catch(() => {});
}

export function AppBadgeSync() {
  useEffect(() => {
    const nav = typeof navigator === "undefined" ? undefined : (navigator as BadgeNavigator);
    if (!nav || typeof nav.setAppBadge !== "function") return;
    let stopped = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/requests/waiting-count", { cache: "no-store" });
        if (!res.ok) return;
        const { count } = (await res.json()) as { count: number | null };
        if (!stopped) applyAppBadge(nav, typeof count === "number" ? count : null);
      } catch {
        // the icon stays as it was
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
