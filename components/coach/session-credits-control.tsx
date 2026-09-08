"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

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
  const [saving, setSaving] = useState(false);

  async function adjust(delta: number) {
    setSaving(true);
    const supabase = createBrowserClient();
    // An atomic DB-side increment rather than read-then-write — closes the
    // same race the booking flow had (two edits landing off the same
    // stale starting balance).
    const { data: newBalance } = await supabase.rpc("adjust_session_credits", {
      p_athlete_id: athleteId,
      p_group_id: groupId,
      p_delta: delta,
    });
    if (typeof newBalance === "number") setBalance(newBalance);
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-body text-xs text-steel uppercase tracking-wide">
        Session credits
      </span>
      <button
        type="button"
        onClick={() => adjust(-1)}
        disabled={saving || balance === 0}
        className="w-8 h-8 flex items-center justify-center border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
      >
        &minus;
      </button>
      <span className="font-display text-lg w-6 text-center">{balance}</span>
      <button
        type="button"
        onClick={() => adjust(1)}
        disabled={saving}
        className="w-8 h-8 flex items-center justify-center border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
