"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const CHECK_INTERVAL_MS = 1000;
const REFRESH_AFTER_MS = 5000;
const RELOAD_AFTER_MS = 9000;
const MARKER_SELECTOR = "[data-loading-fallback]";

// Root cause (verified live in production, 2026-09-15): on a hard/direct
// navigation, Next streams a loading.tsx fallback first and the fully
// resolved real page content later in the same response — but swapping the
// fallback for that content depends on requestAnimationFrame (and, we found
// on testing this fix, on that specific Suspense boundary's OWN client-side
// hydration), neither of which browsers reliably run for a hidden/unfocused
// tab. The real content can already be sitting in the DOM, fully rendered,
// while nothing ever displays it.
//
// This component is deliberately mounted once, in the root layout, OUTSIDE
// every route segment's own Suspense boundary — confirmed via direct DOM
// inspection that the root layout hydrates promptly even while a nested
// loading.tsx fallback's own subtree does not. From there it can't rely on
// its own mount/unmount lifecycle to know a *specific* fallback is stuck
// (it's not inside one), so instead it polls the DOM for the
// `data-loading-fallback` marker every loading.tsx's skeleton carries. If
// that marker has been continuously present for a few seconds, something
// downstream is stuck — force a router.refresh() (a live, already-hydrated
// re-render through React's own scheduler, not requestAnimationFrame or
// fresh hydration), escalating to a hard reload if even that doesn't clear
// it. On the fast/common path the marker disappears within a second or two
// and this never does anything.
export function LoadingWatchdog() {
  const router = useRouter();
  const stuckSinceRef = useRef<number | null>(null);
  const refreshedRef = useRef(false);
  const reloadedRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const stillStuck = !!document.querySelector(MARKER_SELECTOR);

      if (!stillStuck) {
        stuckSinceRef.current = null;
        refreshedRef.current = false;
        reloadedRef.current = false;
        return;
      }

      if (stuckSinceRef.current === null) {
        stuckSinceRef.current = Date.now();
        return;
      }

      const stuckFor = Date.now() - stuckSinceRef.current;

      if (stuckFor >= RELOAD_AFTER_MS && !reloadedRef.current) {
        reloadedRef.current = true;
        window.location.reload();
      } else if (stuckFor >= REFRESH_AFTER_MS && !refreshedRef.current) {
        refreshedRef.current = true;
        router.refresh();
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [router]);

  return null;
}
