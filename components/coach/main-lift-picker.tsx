"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Strength Meet Week Taper — a coach's own movement-pattern taxonomy
// isn't something the client who proposed the goal would know, so this
// is coach-set, immediate-persist, same pattern as every other inline
// control on this page (SessionCreditsControl, etc.). Rendered
// independently of goal confirm/decline so a coach can set or change
// the linked movement pattern at any time, not just at the moment of
// confirming — there's no other revisit point once a goal is confirmed.
export function MainLiftPicker({
  goalId,
  movementPatterns,
  currentPatternId,
}: {
  goalId: string;
  movementPatterns: { id: string; name: string }[];
  currentPatternId: string | null;
}) {
  const [value, setValue] = useState(currentPatternId ?? "");
  const [saving, setSaving] = useState(false);

  async function handleChange(next: string) {
    setValue(next);
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase
      .from("client_goals")
      .update({ main_lift_movement_pattern_id: next || null })
      .eq("id", goalId);
    setSaving(false);
  }

  if (movementPatterns.length === 0) {
    return (
      <p className="font-body text-xs text-steel">
        No movement patterns set up yet — add one from Exercise Library to link a main lift.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label className="font-body text-xs text-steel uppercase tracking-wide">Main lift</label>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={saving}
        className="h-8 bg-surface border border-steel/30 text-chalk px-2 font-body text-xs disabled:opacity-40"
      >
        <option value="">Not set</option>
        {movementPatterns.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
