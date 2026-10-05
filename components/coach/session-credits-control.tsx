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
  const [error, setError] = useState<string | null>(null);

  function adjust(delta: number) {
    // A balance is money the client paid for. One stray tap on a small
    // button must not add or remove a session without a second look.
    const verb = delta < 0 ? "Remove 1 session credit from" : "Add 1 session credit to";
    if (!window.confirm(`${verb} this client? Their balance goes from ${balance} to ${balance + delta}.`)) {
      return;
    }

    setError(null);
    const before = balance;
    // Reflect the change on the button instantly — the actual write stays
    // an atomic DB-side increment (not a naive read-then-write, which
    // would reopen the same race the booking flow had), it just runs in
    // the background instead of the +/- waiting on a round-trip. The
    // authoritative balance corrects this once the RPC resolves, in case
    // it clamped (e.g. hit the zero floor) or genuinely failed.
    setBalance((prev) => prev + delta);
    const supabase = createBrowserClient();
    supabase
      .rpc("adjust_session_credits", {
        p_athlete_id: athleteId,
        p_group_id: groupId,
        p_delta: delta,
      })
      .then(({ data: newBalance, error: rpcError }) => {
        if (rpcError) {
          setBalance(before);
          setError("That change didn't save. The balance is back to what it was.");
          return;
        }
        if (typeof newBalance === "number") setBalance(newBalance);
        // Only a real spend is worth checking — an increase (a manual
        // top-up) never needs the low-balance staircase.
        if (delta < 0) checkAndNotifyLowSessionBalance(athleteId, groupId);
      });
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="font-body text-xs text-steel uppercase tracking-wide">
          Session credits
        </span>
        <button
          type="button"
          onClick={() => adjust(-1)}
          aria-label="Remove one session credit"
          className="w-11 h-11 flex items-center justify-center border border-steel/30 text-steel font-body text-lg active:border-rust active:text-rust transition-colors disabled:opacity-40"
        >
          &minus;
        </button>
        <span className="font-display text-lg min-w-6 text-center">{balance}</span>
        {balance < 0 && <span className="font-body text-xs text-rust">Owed {Math.abs(balance)}</span>}
        <button
          type="button"
          onClick={() => adjust(1)}
          aria-label="Add one session credit"
          className="w-11 h-11 flex items-center justify-center border border-steel/30 text-steel font-body text-lg active:border-rust active:text-rust transition-colors disabled:opacity-40"
        >
          +
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
