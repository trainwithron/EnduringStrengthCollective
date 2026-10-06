"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// How many days before a client's sessions expire you are prompted to check in with them. A prompt only: nothing is sent to the client and
// nothing expires early. 0 turns the prompt off. Saved on its own so the other booking policies never depend on it.
export function ExpiryHeadsUpControl({ coachId, initialDays }: { coachId: string; initialDays: number }) {
  const [saved, setSaved] = useState(initialDays);
  const [draft, setDraft] = useState(String(initialDays));
  const [error, setError] = useState<string | null>(null);

  async function commit() {
    const n = draft.trim() === "" ? 0 : Number(draft);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      setError("Enter a whole number of days from 0 to 365.");
      setDraft(String(saved));
      return;
    }
    setDraft(String(n));
    if (n === saved) return;
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase
      .from("coach_booking_policies")
      .upsert({ coach_id: coachId, expiry_heads_up_days: n }, { onConflict: "coach_id" });
    if (saveError) {
      setError("That didn't save. It is back to what it was.");
      setDraft(String(saved));
      return;
    }
    setSaved(n);
  }

  return (
    <div className="border border-steel/20 bg-surface/40 rounded-token-lg p-4 mb-6 max-w-md">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">Check-in before sessions expire</p>
      <p className="font-body text-xs text-steel mb-2">
        You are prompted this many days before a client&apos;s unused sessions expire, with a drafted note you can edit and send. Nothing goes to the
        client by itself. You can extend or pause expiry for any one client. 0 turns the prompt off.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          aria-label="Days before expiry"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
          }}
          className="w-24 h-11 bg-graphite border border-steel/30 text-chalk px-2 font-body text-base sm:text-sm focus:outline-none focus:border-rust"
        />
        <span className="font-body text-sm text-steel">days before</span>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-2" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
