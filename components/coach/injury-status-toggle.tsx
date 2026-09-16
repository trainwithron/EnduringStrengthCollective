"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// coach_em_up_finley_funston_transcript.md — real client-safety gap:
// undereating while injured measurably delays recovery, but the
// nutrition check-in engine had no way to know a client was injured at
// all, so it just kept applying whatever deficit was already active. A
// simple, manually-set interim mechanism — the full AI injury-detection
// trigger (injury_keyword_ai_classification_idea.md) is a separate,
// bigger, not-yet-built piece. Coach sets this on, the check-in engine
// floors calories at maintenance (or a real coach-chosen surplus)
// regardless of phase, until the coach clears it.
export function InjuryStatusToggle({
  athleteId,
  groupId,
  coachId,
  initialIsInjured,
  initialSurplusPct,
}: {
  athleteId: string;
  groupId: string;
  coachId: string;
  initialIsInjured: boolean;
  initialSurplusPct: number;
}) {
  const [isInjured, setIsInjured] = useState(initialIsInjured);
  const [surplusPct, setSurplusPct] = useState(initialSurplusPct);
  const [saving, setSaving] = useState(false);

  async function persist(nextIsInjured: boolean, nextSurplusPct: number) {
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase.from("athlete_injury_status").upsert(
      {
        athlete_id: athleteId,
        group_id: groupId,
        is_injured: nextIsInjured,
        surplus_pct: nextSurplusPct,
        marked_by: coachId,
        marked_at: nextIsInjured ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "athlete_id" }
    );
    setSaving(false);
  }

  async function handleToggle() {
    const next = !isInjured;
    setIsInjured(next);
    await persist(next, surplusPct);
  }

  async function handleSurplusChange(value: number) {
    setSurplusPct(value);
    if (isInjured) await persist(true, value);
  }

  return (
    <div
      className={`border rounded-token-lg p-3 ${
        isInjured ? "border-rust/40 bg-rust/5" : "border-steel/20 bg-surface"
      }`}
    >
      <label className="flex items-center gap-2 font-body text-sm text-chalk cursor-pointer">
        <input type="checkbox" checked={isInjured} disabled={saving} onChange={handleToggle} />
        Currently injured
      </label>
      <p className="font-body text-[11px] text-steel mt-1 max-w-[42ch]">
        {isInjured
          ? "Nutrition check-ins floor this client's calories at maintenance (never a deficit) until you clear this. Undereating while injured measurably delays recovery."
          : "When set, nutrition check-ins won't cut this client's calories below maintenance, regardless of their active phase."}
      </p>
      {isInjured && (
        <label className="flex items-center gap-2 font-body text-xs text-steel mt-2">
          Surplus above maintenance
          <input
            type="number"
            min={0}
            max={10}
            value={surplusPct}
            disabled={saving}
            onChange={(e) => handleSurplusChange(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            className="w-14 h-7 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs disabled:opacity-40"
          />
          <span className="text-[11px]">% (0 = maintenance only, up to a real 5-10% surplus)</span>
        </label>
      )}
    </div>
  );
}
