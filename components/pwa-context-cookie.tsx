"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { writeStandaloneCookie } from "@/lib/pwa";

// Re-evaluates and writes the standalone-display cookie so server
// components can read `isPwaStandalone()` and decide whether a coach
// should see the athlete-style mobile experience instead of the full
// desktop coaching tools. Renders nothing — this is purely a
// signal-setting effect.
//
// Real bug this fixes: this cookie is shared across every tab/window on
// the same origin (cookies are scoped per-origin, not per-tab), but this
// component lives in the root layout, which — by design — mounts once
// and stays mounted across every client-side navigation within one tab.
// A plain `useEffect(fn, [])` therefore only ever wrote the cookie once,
// on that tab's very first load. A coach who keeps the installed
// standalone app open in one window and a regular desktop-shell browser
// tab open in another (this app's own DownloadAppButton copy assumes
// exactly that split) would have whichever tab loaded LAST silently
// decide which view BOTH tabs render on their next navigation, since
// neither tab ever re-asserted its own real state afterward — the
// intermittent "sometimes it opens as desktop" / "I was in the mobile
// view and somehow ended up in desktop" reports.
//
// Fixed by re-asserting the correct value for THIS tab (a) on every
// client-side route change, via the `pathname` dependency, and (b)
// whenever this tab regains focus/visibility — so switching back to an
// already-open tab self-corrects immediately, before the next tap can
// read a value clobbered by the other tab in the meantime.
export function PwaContextCookie() {
  const pathname = usePathname();

  useEffect(() => {
    writeStandaloneCookie();
  }, [pathname]);

  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState === "visible") writeStandaloneCookie();
    }
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
    };
  }, []);

  return null;
}
