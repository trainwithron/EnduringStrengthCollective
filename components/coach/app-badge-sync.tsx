"use client";

import { useEffect } from "react";
import { SPOT_NEEDS_CACHE_KEY, badgeCountOf, fetchSpotNeeds, readSpotNeedsCache, spotNeedsCacheEntry } from "@/lib/spot-needs";
import { ACTIVE_ORG_COOKIE, readBrowserCookie } from "@/lib/active-org";

// The number on the installed app's icon (Ron, Nov 20, wave 3 C10; Nov 21, PH1: the same number as the Spotlight dot and "Waiting for you (n)", from the same answer, lib/spot-needs.ts).
// Where the device supports app badges (an installed app on most phones and desktops), the icon shows how many things wait for the coach, and nothing when there are none. Anywhere else
// this does nothing. Checked when a coach page opens, once when the app comes back to the front, and every five minutes while it is on screen (never in a hidden tab; an answer under a
// minute old is used again).
// Spotlight also sets it each time it reads what is waiting. Draws nothing.
const EVERY_MS = 5 * 60 * 1000;

type BadgeNavigator = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export function applyAppBadge(nav: BadgeNavigator | undefined, count: number | null): void {
  if (!nav || typeof nav.setAppBadge !== "function" || count === null) return;
  if (count > 0) void nav.setAppBadge(count).catch(() => {});
  else if (typeof nav.clearAppBadge === "function") void nav.clearAppBadge().catch(() => {});
}

/** Sets the icon from an answer Spotlight just read (so the icon and the dot never disagree). */
export function syncAppBadge(count: number | null): void {
  if (typeof navigator === "undefined") return;
  applyAppBadge(navigator as BadgeNavigator, count);
}

export function AppBadgeSync() {
  useEffect(() => {
    const nav = typeof navigator === "undefined" ? undefined : (navigator as BadgeNavigator);
    if (!nav || typeof nav.setAppBadge !== "function") return;
    let stopped = false;
    const refresh = async () => {
      // A hidden tab never asks (an idle open page must not keep polling); coming back to the front asks once.
      if (document.visibilityState !== "visible") return;
      const org = readBrowserCookie(ACTIVE_ORG_COOKIE);
      try {
        const kept = readSpotNeedsCache(window.sessionStorage.getItem(SPOT_NEEDS_CACHE_KEY), org, Date.now());
        if (kept) {
          if (!stopped) applyAppBadge(nav, badgeCountOf(kept));
          return;
        }
      } catch {
        // no storage: read it
      }
      const data = await fetchSpotNeeds();
      if (!data || stopped) return; // the icon stays as it was
      try {
        window.sessionStorage.setItem(SPOT_NEEDS_CACHE_KEY, spotNeedsCacheEntry(data, org, Date.now()));
      } catch {
        // not kept: the next check reads it again
      }
      applyAppBadge(nav, badgeCountOf(data));
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
