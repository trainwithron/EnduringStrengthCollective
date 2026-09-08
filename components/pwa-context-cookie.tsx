"use client";

import { useEffect } from "react";
import { writeStandaloneCookie } from "@/lib/pwa";

// Re-evaluates and writes the standalone-display cookie on every page
// load, so server components can read `isPwaStandalone()` and decide
// whether a coach opening the installed app should see the athlete-style
// mobile experience instead of the full desktop coaching tools. Renders
// nothing — this is purely a signal-setting effect.
export function PwaContextCookie() {
  useEffect(() => {
    writeStandaloneCookie();
  }, []);
  return null;
}
