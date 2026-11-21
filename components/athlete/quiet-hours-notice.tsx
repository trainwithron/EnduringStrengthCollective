"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { readPushPrefs } from "@/lib/push-prefs";
import { deviceTimeZone, quietHoursNotice } from "@/lib/quiet-notice";
import { lapsesSoon } from "@/lib/request-deadline";

// One quiet line under a request that was just sent, when the coach is in their quiet hours (Ron, Nov 20: "It's late. Your coach has quiet hours set. Expect a reply in the
// morning."). The coach's own quiet-hours setting, read the same way their phone alerts read it (a client can see their coach's profile); in the client's own time zone.
// Shows nothing outside the coach's quiet hours, with none set, or when the setting cannot be read. Pass `text` when the line was already worked out on the server.
export function QuietHoursNotice({
  coachId,
  seriesId,
  bookingId,
  text,
  className = "",
  onLine,
  lapsesAt,
}: {
  coachId?: string | null;
  // a weekly-schedule request, or a request to move a session: the coach is the schedule's or the session's own (the client can read their own)
  seriesId?: string | null;
  bookingId?: string | null;
  text?: string | null;
  className?: string;
  // told the line once it is known (null: no line), so a screen that moves on by itself can wait while it shows
  onLine?: (line: string | null) => void;
  // when the request lapses if unanswered (a session request: its time, or a move's original time). Within 12 hours the coach is told even in their quiet hours (wave 3 C9),
  // so no "reply in the morning" is promised: no line.
  lapsesAt?: string | null;
}) {
  const [line, setLine] = useState<string | null>(text ?? null);

  useEffect(() => {
    if (text !== undefined) {
      setLine(text ?? null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserClient();
        let coach = coachId ?? null;
        // A weekly-schedule request: the coach is the schedule's own (the client can read their own schedule).
        if (!coach && seriesId) {
          const { data } = await supabase.from("recurring_booking_series").select("coach_id").eq("id", seriesId).maybeSingle();
          coach = (data as { coach_id?: string | null } | null)?.coach_id ?? null;
        }
        let lapse = lapsesAt ?? null;
        if (!coach && bookingId) {
          const { data } = await supabase.from("bookings").select("coach_id, start_at").eq("id", bookingId).maybeSingle();
          coach = (data as { coach_id?: string | null } | null)?.coach_id ?? null;
          // a request to move this session lapses at the session's own (original) time
          lapse = lapse ?? (data as { start_at?: string | null } | null)?.start_at ?? null;
        }
        if (lapsesSoon(lapse)) {
          onLine?.(null);
          return;
        }
        if (!coach) return;
        const prefs = await readPushPrefs(supabase, coach);
        if (!cancelled) {
          const next = quietHoursNotice(prefs, deviceTimeZone());
          setLine(next);
          onLine?.(next);
        }
      } catch {
        // no line
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coachId, seriesId, bookingId, text, lapsesAt]);

  if (!line) return null;
  return (
    <span className={`block font-body text-[13px] text-steel ${className}`} role="status" data-quiet-hours-notice>
      {line}
    </span>
  );
}
