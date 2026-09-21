"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export function BookingPolicyControl({
  coachId,
  initialCancellationHours,
  initialBufferMinutes,
  initialMinimumNoticeHours,
  initialCreditExpiryDays,
}: {
  coachId: string;
  initialCancellationHours: number;
  initialBufferMinutes: number;
  initialMinimumNoticeHours: number;
  initialCreditExpiryDays: number;
}) {
  const [cancellationHours, setCancellationHours] = useState(initialCancellationHours);
  const [bufferMinutes, setBufferMinutes] = useState(initialBufferMinutes);
  const [minimumNoticeHours, setMinimumNoticeHours] = useState(initialMinimumNoticeHours);
  const [creditExpiryDays, setCreditExpiryDays] = useState(initialCreditExpiryDays);
  const [saved, setSaved] = useState(true);

  async function persist(next: {
    cancellationHours: number;
    bufferMinutes: number;
    minimumNoticeHours: number;
    creditExpiryDays: number;
  }) {
    setCancellationHours(next.cancellationHours);
    setBufferMinutes(next.bufferMinutes);
    setMinimumNoticeHours(next.minimumNoticeHours);
    setCreditExpiryDays(next.creditExpiryDays);
    setSaved(false);
    const supabase = createBrowserClient();
    await supabase.from("coach_booking_policies").upsert(
      {
        coach_id: coachId,
        cancellation_window_hours: next.cancellationHours,
        buffer_minutes: next.bufferMinutes,
        minimum_notice_hours: next.minimumNoticeHours,
        credit_expiry_days: next.creditExpiryDays,
      },
      { onConflict: "coach_id" }
    );
    setSaved(true);
  }

  return (
    <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-4 mb-6 max-w-md space-y-4">
      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Cancellation policy</p>
        <p className="font-body text-xs text-steel mb-2">
          A client who cancels or reschedules within this many hours of their session forfeits the credit
          instead of getting it back.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={cancellationHours}
            onChange={(e) =>
              persist({ cancellationHours: Number(e.target.value) || 0, bufferMinutes, minimumNoticeHours, creditExpiryDays })
            }
            className="w-20 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
          />
          <span className="font-body text-sm text-steel">hours before the session</span>
        </div>
      </div>

      <div className="border-t border-steel/15 pt-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Buffer between sessions</p>
        <p className="font-body text-xs text-steel mb-2">
          Blocks a client from booking a session that starts too close to another one already on your
          calendar — real recovery/travel time between sessions.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={bufferMinutes}
            onChange={(e) =>
              persist({ cancellationHours, bufferMinutes: Number(e.target.value) || 0, minimumNoticeHours, creditExpiryDays })
            }
            className="w-20 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
          />
          <span className="font-body text-sm text-steel">minutes before and after each session</span>
        </div>
      </div>

      <div className="border-t border-steel/15 pt-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Minimum booking notice</p>
        <p className="font-body text-xs text-steel mb-2">
          A client can&apos;t book a session starting sooner than this — doesn&apos;t apply when you book a
          session for a client yourself.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={minimumNoticeHours}
            onChange={(e) =>
              persist({ cancellationHours, bufferMinutes, minimumNoticeHours: Number(e.target.value) || 0, creditExpiryDays })
            }
            className="w-20 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
          />
          <span className="font-body text-sm text-steel">hours of advance notice required</span>
        </div>
      </div>

      <div className="border-t border-steel/15 pt-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Credit expiration</p>
        <p className="font-body text-xs text-steel mb-2">
          A client&apos;s unused session credits expire this many days after their most recent purchase or
          top-up. Set to 0 to never expire.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={creditExpiryDays}
            onChange={(e) =>
              persist({ cancellationHours, bufferMinutes, minimumNoticeHours, creditExpiryDays: Number(e.target.value) || 0 })
            }
            className="w-20 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
          />
          <span className="font-body text-sm text-steel">days, 0 = never</span>
        </div>
      </div>

      {!saved && <p className="font-body text-[11px] text-steel">saving…</p>}
    </div>
  );
}
