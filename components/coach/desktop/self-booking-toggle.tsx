"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Coach-wide switch: may clients book their own sessions? OFF by default. While it is off a client sees their own sessions (and can cancel or
// move them) but is not offered open times, and the database refuses a booking the client makes for themselves. A coach can always schedule.
export function SelfBookingToggle({ coachId, initialEnabled }: { coachId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase
      .from("coach_booking_policies")
      .upsert({ coach_id: coachId, self_booking_enabled: next }, { onConflict: "coach_id" });
    if (saveError) {
      setEnabled(!next);
      setError("That didn't save. The switch is back to what it was.");
    }
  }

  return (
    <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-4 mb-6 max-w-md">
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={toggle} className="mt-1 w-5 h-5 accent-rust shrink-0" />
        <span>
          <span className="font-body text-sm text-chalk block">Let clients book their own sessions</span>
          <span className="font-body text-xs text-steel block mt-0.5">
            Off: you schedule every session and clients only see and manage the ones you set. On: clients can pick an open time themselves.
          </span>
        </span>
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
