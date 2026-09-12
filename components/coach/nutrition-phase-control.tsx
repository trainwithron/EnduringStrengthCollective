"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Milestone Celebrations flagship (reverse-diet detector) — the coach's
// own explicit opt-in tag. The detector only ever fires for an athlete
// tagged here, avoiding a false "congratulations" for someone who just
// happened to eat more without gaining but wasn't actually on a
// deliberate reverse-diet protocol (Ron's own confirmed decision).
export function NutritionPhaseControl({
  athleteId,
  groupId,
  coachId,
  initialTagged,
  initialStartedAt,
}: {
  athleteId: string;
  groupId: string;
  coachId: string;
  initialTagged: boolean;
  initialStartedAt: string | null;
}) {
  const [tagged, setTagged] = useState(initialTagged);
  const [startedAt, setStartedAt] = useState(initialStartedAt);
  const [saving, setSaving] = useState(false);

  async function handleToggle() {
    setSaving(true);
    const supabase = createBrowserClient();
    if (tagged) {
      await supabase
        .from("nutrition_phases")
        .delete()
        .eq("athlete_id", athleteId)
        .eq("group_id", groupId);
      setTagged(false);
      setStartedAt(null);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      await supabase.from("nutrition_phases").upsert(
        {
          athlete_id: athleteId,
          group_id: groupId,
          phase: "reverse_diet",
          started_at: today,
          created_by: coachId,
        },
        { onConflict: "athlete_id,group_id" }
      );
      setTagged(true);
      setStartedAt(today);
    }
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-3">
      <span className="font-body text-xs text-steel uppercase tracking-wide">
        Reverse diet tracking
      </span>
      <button
        type="button"
        onClick={handleToggle}
        disabled={saving}
        className={`h-8 px-3 border font-body text-xs transition-colors disabled:opacity-40 ${
          tagged
            ? "bg-rust border-rust text-graphite"
            : "border-steel/30 text-steel active:border-rust active:text-rust"
        }`}
      >
        {saving ? "Saving…" : tagged ? "On — untag" : "Tag as reverse dieting"}
      </button>
      {tagged && startedAt && (
        <span className="font-body text-[11px] text-steel">
          since {new Date(`${startedAt}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      )}
    </div>
  );
}
