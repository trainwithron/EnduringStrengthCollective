"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const REFRESH_AFTER_MS = 5000;
const RELOAD_AFTER_MS = 9000;

// Root cause (verified live, 2026-09-15): on a hard/direct navigation, Next
// streams this loading.tsx fallback first and the real resolved page content
// later in the same response — but the final DOM swap is scheduled via
// requestAnimationFrame, which browsers never fire for a hidden/unfocused
// tab. The real content can sit fully-rendered and ready for minutes while
// the swap never runs. Mounting this alongside every loading.tsx fallback
// means: if we're still showing this fallback after a few seconds, force a
// recovery through Next's router (which schedules via React's own scheduler,
// not requestAnimationFrame, so it isn't subject to the same stall) — first
// a soft router.refresh(), then a hard reload if even that doesn't land.
// This unmounts automatically the instant the real content swaps in
// normally, so on the fast/common path it never does anything at all.
export function LoadingWatchdog() {
  const router = useRouter();
  const handledRef = useRef(false);

  useEffect(() => {
    const tryRefresh = () => {
      if (handledRef.current) return;
      handledRef.current = true;
      router.refresh();
    };

    const refreshTimer = setTimeout(tryRefresh, REFRESH_AFTER_MS);
    const reloadTimer = setTimeout(() => {
      window.location.reload();
    }, RELOAD_AFTER_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tryRefresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearTimeout(refreshTimer);
      clearTimeout(reloadTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
