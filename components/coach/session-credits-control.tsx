"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { checkAndNotifyLowSessionBalance } from "@/lib/notify-low-session-balance";

export function SessionCreditsControl({
  athleteId,
  groupId,
  initialBalance,
}: {
  athleteId: string;
  groupId: string;
  initialBalance: number;
}) {
  const [balance, setBalance] = useState(initialBalance);

  function adjust(delta: number) {
    // Reflect the change on the button instantly — the actual write stays
    // an atomic DB-side increment (not a naive read-then-write, which
    // would reopen the same race the booking flow had), it just runs in
    // the background instead of the +/- waiting on a round-trip. The
    // authoritative balance corrects this once the RPC resolves, in case
    // it clamped (e.g. hit the zero floor) or genuinely failed.
    setBalance((prev) => Math.max(0, prev + delta));
    const supabase = createBrowserClient();
    supabase
      .rpc("adjust_session_credits", {
        p_athlete_id: athleteId,
        p_group_id: groupId,
        p_delta: delta,
      })
      .then(({ data: newBalance }) => {
        if (typeof newBalance === "number") setBalance(newBalance);
        // Only a real spend is worth checking — an increase (a manual
        // top-up) never needs the low-balance staircase.
        if (delta < 0) checkAndNotifyLowSessionBalance(athleteId, groupId);
      });
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-body text-xs text-steel uppercase tracking-wide">
        Session credits
      </span>
      <button
        type="button"
        onClick={() => adjust(-1)}
        disabled={balance === 0}
        className="w-8 h-8 flex items-center justify-center border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
      >
        &minus;
      </button>
      <span className="font-display text-lg w-6 text-center">{balance}</span>
      <button
        type="button"
        onClick={() => adjust(1)}
        className="w-8 h-8 flex items-center justify-center border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
