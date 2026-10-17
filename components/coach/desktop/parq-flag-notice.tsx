"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { COACH_DECISIONS, DECISION_BUTTON, type CoachDecision } from "@/lib/par-q-outcome";

// One line on Overview while a client's health screening has a flagged answer the coach has not acknowledged: "Health screening: 2 flagged" and one button. Acknowledging remembers the number the
// coach has seen (on the coach's own private row), so the line stays gone until a NEW flagged answer makes the count higher. The answers themselves stay under Billing & settings.
export function ParqFlagNotice({ athleteId, coachId, flagged }: { athleteId: string; coachId: string; flagged: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [note, setNote] = useState("");
  if (gone) return null;

  async function decide(decision: CoachDecision) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const base = { coach_id: coachId, athlete_id: athleteId, flagged_count: flagged, acknowledged_at: new Date().toISOString() };
    const client = createBrowserClient();
    const first = await client
      .from("athlete_injury_flag_acknowledgements")
      .upsert({ ...base, decision, note: note.trim() ? note.trim().slice(0, 500) : null }, { onConflict: "coach_id,athlete_id" });
    // Until the decision columns exist (their database step) the acknowledgement alone is still saved.
    const { error: problem } = first.error && /decision|note/.test(first.error.message) ? await client.from("athlete_injury_flag_acknowledgements").upsert(base, { onConflict: "coach_id,athlete_id" }) : first;
    setBusy(false);
    if (problem) {
      setError("Couldn't save that. Try again.");
      return;
    }
    setGone(true);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border border-rust/40 bg-rust/5 px-3 py-2">
      <p className="font-body text-sm text-chalk">Health screening: {flagged} flagged. What do you decide?</p>
      <div className="flex flex-wrap gap-2">
        {COACH_DECISIONS.map((d) => (
          <button key={d} type="button" disabled={busy} onClick={() => void decide(d)} className="min-h-11 px-3 border border-rust/50 font-body text-sm text-rust disabled:opacity-40">
            {DECISION_BUTTON[d]}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="Note for yourself (optional)"
        aria-label="Note about this screening"
        className="w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
      />
      {error && (
        <p className="w-full font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
