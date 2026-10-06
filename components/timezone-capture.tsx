"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { legalGateAppliesTo } from "@/lib/legal-status";
import { isValidTimeZone } from "@/lib/format-in-timezone";

// A signed-in person whose profile has no time zone yet gets the one their device reports, saved once. Without it every reminder, booking
// time and "today" falls back to a fixed guess (New York) or to UTC, so a Pacific coach's 6:00 AM reads as 9:00 AM. Checked once per
// browser tab; does nothing for someone who already has one (they can change it in Availability), and never on the signed-out pages.
const KEY = "tz_checked";

export function TimezoneCapture() {
  const pathname = usePathname();

  useEffect(() => {
    if (!legalGateAppliesTo(pathname)) return;
    try {
      if (window.sessionStorage.getItem(KEY) === "1") return;
    } catch {
      // No storage: check each time.
    }
    let cancelled = false;
    (async () => {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!isValidTimeZone(detected)) return;
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: profile } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
      if (cancelled || !profile) return;
      if (!profile.timezone) {
        await supabase.from("profiles").update({ timezone: detected }).eq("id", user.id);
      }
      try {
        window.sessionStorage.setItem(KEY, "1");
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}
