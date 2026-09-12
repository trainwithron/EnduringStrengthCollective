"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { NutritionPhase } from "@/lib/nutrition-trend-classifier";

const PHASE_LABELS: Record<NutritionPhase, string> = {
  reverse_diet: "Reverse diet",
  cut: "Cut",
  bulk: "Bulk",
};

// Milestone Celebrations (flagship + Category 2) — the coach's own
// explicit opt-in tag for whichever nutrition phase an athlete is
// actually running. The trend-based detectors only ever evaluate an
// athlete tagged here, avoiding a false "congratulations" (or a false
// "off track" flag) for someone whose eating just happened to shift
// without a deliberate protocol behind it (Ron's own confirmed
// decision, made for the reverse-diet flagship and extended here).
export function NutritionPhaseControl({
  athleteId,
  groupId,
  coachId,
  initialPhase,
  initialStartedAt,
}: {
  athleteId: string;
  groupId: string;
  coachId: string;
  initialPhase: NutritionPhase | null;
  initialStartedAt: string | null;
}) {
  const [phase, setPhase] = useState<NutritionPhase | null>(initialPhase);
  const [startedAt, setStartedAt] = useState(initialStartedAt);
  const [saving, setSaving] = useState(false);

  async function handleChange(value: string) {
    setSaving(true);
    const supabase = createBrowserClient();
    if (!value) {
      await supabase
        .from("nutrition_phases")
        .delete()
        .eq("athlete_id", athleteId)
        .eq("group_id", groupId);
      setPhase(null);
      setStartedAt(null);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      await supabase.from("nutrition_phases").upsert(
        {
          athlete_id: athleteId,
          group_id: groupId,
          phase: value,
          started_at: today,
          created_by: coachId,
        },
        { onConflict: "athlete_id,group_id" }
      );
      setPhase(value as NutritionPhase);
      setStartedAt(today);
    }
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-body text-xs text-steel uppercase tracking-wide">
        Nutrition phase tracking
      </span>
      <select
        value={phase ?? ""}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="h-8 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust disabled:opacity-40"
      >
        <option value="">Not tracking</option>
        {(Object.keys(PHASE_LABELS) as NutritionPhase[]).map((p) => (
          <option key={p} value={p}>
            {PHASE_LABELS[p]}
          </option>
        ))}
      </select>
      {phase && startedAt && (
        <span className="font-body text-[11px] text-steel">
          since {new Date(`${startedAt}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}
