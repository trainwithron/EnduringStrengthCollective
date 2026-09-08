"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

export function CancellationPolicyControl({
  coachId,
  initialHours,
}: {
  coachId: string;
  initialHours: number;
}) {
  const [hours, setHours] = useState(initialHours);
  const [saved, setSaved] = useState(true);

  async function persist(next: number) {
    setHours(next);
    setSaved(false);
    const supabase = createBrowserClient();
    await supabase
      .from("coach_booking_policies")
      .upsert({ coach_id: coachId, cancellation_window_hours: next }, { onConflict: "coach_id" });
    setSaved(true);
  }

  return (
    <div className="border border-steel/20 bg-surface/40 p-4 mb-6 max-w-md">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">
        Cancellation policy
      </p>
      <p className="font-body text-xs text-steel mb-3">
        A client who cancels or reschedules within this many hours of their
        session forfeits the credit instead of getting it back.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={hours}
          onChange={(e) => persist(Number(e.target.value) || 0)}
          className="w-20 h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />
        <span className="font-body text-sm text-steel">hours before the session</span>
        {!saved && <span className="font-body text-[11px] text-steel">saving…</span>}
      </div>
    </div>
  );
}
