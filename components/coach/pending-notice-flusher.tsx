"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { announce, flushDueNotices } from "@/lib/flush-pending-notices";
import { removePending, type PendingNotice } from "@/lib/pending-booking-notices";

// Sits in the coach screens. A booking made from the calendar whose tab was closed before its Undo time ran out is announced to the client the next time any coach
// screen opens. One that waited a long time is not sent on its own: the coach is asked.
export function PendingNoticeFlusher() {
  const [stale, setStale] = useState<PendingNotice[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const result = await flushDueNotices(supabase, user.id);
      if (!cancelled && result.stale.length > 0) setStale(result.stale);
    }
    run().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (stale.length === 0) return null;
  return (
    <div className="border border-rust/40 bg-rust/5 px-4 py-3 mb-4" role="status">
      <p className="font-body text-sm text-chalk">
        {stale.length === 1 ? "1 session you booked was never announced to the client." : `${stale.length} sessions you booked were never announced to the clients.`} They are on your calendar. Tell them now?
      </p>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          onClick={() => {
            stale.forEach(announce);
            setStale([]);
          }}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium"
        >
          Tell them
        </button>
        <button
          type="button"
          onClick={() => {
            stale.forEach((n) => removePending(n.bookingId));
            setStale([]);
          }}
          className="h-9 px-4 border border-steel/40 text-chalk font-body text-sm"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
