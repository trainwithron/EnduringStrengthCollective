"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { legalGateAppliesTo } from "@/lib/legal-status";
import { isValidTimeZone } from "@/lib/format-in-timezone";
import { DEVICE_TZ_COOKIE, readDeviceZoneCookie, zoneLabel } from "@/lib/display-timezone";

// Two jobs, both for a signed-in person on the app pages (never the signed-out pages):
// 1. A profile with no time zone yet gets the one the device reports, saved once. Without it every reminder, booking time and "today" falls back to a
//    fixed guess (New York) or to UTC, so a Pacific coach's 6:00 AM reads as 9:00 AM. Someone who already has one keeps it (they can change it in Availability).
// 2. The device's zone is remembered in a cookie so server-rendered pages show times in the zone the device is in. This never changes the saved zone: a
//    coach's hours and booked sessions stay anchored to it. A coach whose device is in another zone sees a one-line, dismissible note saying so.
// Checked once per page load.
let checkedThisLoad = false;
const NOTE_DISMISSED_KEY = "tz_note_dismissed";

export function TimezoneCapture() {
  const pathname = usePathname();
  const router = useRouter();
  const [noteZone, setNoteZone] = useState<string | null>(null);

  useEffect(() => {
    if (checkedThisLoad || !legalGateAppliesTo(pathname)) return;
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
      checkedThisLoad = true;
      if (!profile.timezone) {
        await supabase.from("profiles").update({ timezone: detected }).eq("id", user.id);
      }
      const saved: string | null = profile.timezone ?? detected;

      const before = readDeviceZoneCookie(document.cookie) ?? saved;
      document.cookie = `${DEVICE_TZ_COOKIE}=${encodeURIComponent(detected)}; path=/; max-age=31536000; samesite=lax`;
      // Pages already drawn used the zone in `before`; redraw them if the device is somewhere else.
      if (before !== detected) router.refresh();

      if (detected !== saved) {
        const { data: coachRow } = await supabase
          .from("group_memberships")
          .select("profile_id")
          .eq("profile_id", user.id)
          .eq("role", "coach")
          .limit(1)
          .maybeSingle();
        let dismissed = false;
        try {
          dismissed = window.sessionStorage.getItem(NOTE_DISMISSED_KEY) === detected;
        } catch {
          // No storage: show it.
        }
        if (coachRow && !dismissed && !cancelled) setNoteZone(detected);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  if (!noteZone) return null;
  return (
    <div
      role="status"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-graphite border border-steel/40 px-3 py-2 font-body text-xs text-chalk shadow-lg max-w-[calc(100vw-2rem)]"
    >
      <span>Now showing {zoneLabel(noteZone)}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            window.sessionStorage.setItem(NOTE_DISMISSED_KEY, noteZone);
          } catch {
            // ignore
          }
          setNoteZone(null);
        }}
        className="text-steel active:text-rust"
      >
        ✕
      </button>
    </div>
  );
}
