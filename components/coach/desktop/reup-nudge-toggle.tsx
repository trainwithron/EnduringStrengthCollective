"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Coach-wide switch for the "Remind" button on clients who have run out of sessions. On by default. A client can also be put
// on hold one by one from the Clients page. Saved on its own so the other booking policies never depend on it.
export function ReupNudgeToggle({ coachId, initialEnabled }: { coachId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase
      .from("coach_booking_policies")
      .upsert({ coach_id: coachId, reup_nudges_enabled: next }, { onConflict: "coach_id" });
    if (saveError) {
      setEnabled(!next);
      setError("That didn't save. Try again.");
    }
  }

  return (
    <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-4 mb-6 max-w-md">
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={toggle} className="mt-1 accent-rust" />
        <span>
          <span className="font-body text-sm text-chalk block">Remind clients to re-up</span>
          <span className="font-body text-xs text-steel block mt-0.5">
            Shows a Remind button on clients who have run out of sessions. A client is never reminded more than once every 3
            days, and you can put any client on hold.
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
