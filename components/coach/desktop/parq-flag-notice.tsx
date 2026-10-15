"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// One line on Overview while a client's health screening has a flagged answer the coach has not acknowledged: "Health screening: 2 flagged" and one button. Acknowledging remembers the number the
// coach has seen (on the coach's own private row), so the line stays gone until a NEW flagged answer makes the count higher. The answers themselves stay under Billing & settings.
export function ParqFlagNotice({ athleteId, coachId, flagged }: { athleteId: string; coachId: string; flagged: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  if (gone) return null;

  async function acknowledge() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: problem } = await createBrowserClient()
      .from("athlete_injury_flag_acknowledgements")
      .upsert({ coach_id: coachId, athlete_id: athleteId, flagged_count: flagged, acknowledged_at: new Date().toISOString() }, { onConflict: "coach_id,athlete_id" });
    setBusy(false);
    if (problem) {
      setError("Couldn't save that. Try again.");
      return;
    }
    setGone(true);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border border-rust/40 bg-rust/5 px-3 py-1">
      <p className="font-body text-sm text-chalk">Health screening: {flagged} flagged</p>
      <button type="button" disabled={busy} onClick={() => void acknowledge()} className="min-h-11 px-3 font-body text-sm text-rust underline underline-offset-2 disabled:opacity-40">
        Acknowledge
      </button>
      {error && (
        <p className="w-full font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
