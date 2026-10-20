"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const CHECK_INTERVAL_MS = 1000;
export const REFRESH_AFTER_MS = 5000;
export const SECOND_REFRESH_AFTER_MS = 10000;
// Never more than this many refreshes for one page (its path and query), however often a loading screen comes back.
export const MAX_REFRESHES_PER_PAGE = 2;
const MARKER_SELECTOR = "[data-loading-fallback]";

// Root cause (verified live in production, 2026-09-15): on a hard/direct navigation, Next streams a loading.tsx fallback first and the fully resolved real page content later in the same
// response, but swapping the fallback for that content depends on requestAnimationFrame (and that Suspense boundary's own client-side hydration), which browsers do not reliably run for a
// hidden/unfocused tab. The real content can already be in the DOM while nothing displays it. Mounted once in the root layout, outside every route's Suspense boundary, this polls the DOM for
// the `data-loading-fallback` marker every loading screen carries and, if one has been on screen for a few seconds, asks for a soft router.refresh().
//
// Oct 20 outage (the site timed out for ~40 minutes): the old version RESET its flags whenever the marker went away. Under load every refresh streamed a loading screen again for more than 5
// seconds, so it refreshed again, every ~5 s, nonstop (one open /dashboard tab made ~680 database requests a minute and filled the connection pool). Now:
//   - at most MAX_REFRESHES_PER_PAGE refreshes per page (path + query), counted for as long as the tab lives, never reset by the marker coming back;
//   - never inside an embedded frame (the split screen half, a workspace pane): the page that holds the frame decides;
//   - never while the tab is hidden (nobody is looking; the refresh is pure load);
//   - a marker inside something hidden (display: none, a closed panel) does not count.
// Never window.location.reload(): a hard reload throws away anything the person has typed, and a slow connection is not a stuck page.
const refreshesByPage = new Map<string, number>();

export function shouldRefresh(input: { stuckForMs: number; refreshesDone: number; visible: boolean; embedded: boolean }): boolean {
  if (input.embedded || !input.visible) return false;
  if (input.refreshesDone >= MAX_REFRESHES_PER_PAGE) return false;
  return input.stuckForMs >= (input.refreshesDone === 0 ? REFRESH_AFTER_MS : SECOND_REFRESH_AFTER_MS);
}

/** A loading marker that is actually on screen (an element with no boxes, e.g. under display: none, is not). */
export function markerOnScreen(root: ParentNode): boolean {
  return Array.from(root.querySelectorAll(MARKER_SELECTOR)).some((el) => (el as HTMLElement).getClientRects().length > 0);
}

export function isEmbeddedWindow(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // a cross-origin parent: certainly embedded
    return true;
  }
}

export function LoadingWatchdog() {
  const router = useRouter();
  const pathname = usePathname();
  const stuckSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (isEmbeddedWindow()) return;
    stuckSinceRef.current = null;
    const interval = setInterval(() => {
      if (!markerOnScreen(document)) {
        stuckSinceRef.current = null;
        return;
      }
      if (stuckSinceRef.current === null) {
        stuckSinceRef.current = Date.now();
        return;
      }
      const page = `${pathname}${window.location.search}`;
      const done = refreshesByPage.get(page) ?? 0;
      if (shouldRefresh({ stuckForMs: Date.now() - stuckSinceRef.current, refreshesDone: done, visible: document.visibilityState === "visible", embedded: false })) {
        refreshesByPage.set(page, done + 1);
        stuckSinceRef.current = Date.now();
        router.refresh();
      }
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [router, pathname]);

  return null;
}
