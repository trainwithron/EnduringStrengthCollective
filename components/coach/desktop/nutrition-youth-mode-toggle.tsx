"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Standard vs. Youth/Team nutrition display mode, per group — mirrors
// team_mode's own coach-toggle pattern. Youth mode shows a protein-first
// hero with no calorie-deficit framing on the athlete's Nutrition tab,
// a real disordered-eating-safety decision from the calorie-tracking
// research, not a cosmetic option.
export function NutritionYouthModeToggle({
  groupId,
  initialEnabled,
}: {
  groupId: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setEnabled(next);
    const supabase = createBrowserClient();
    const { error } = await supabase.from("groups").update({ nutrition_youth_mode: next }).eq("id", groupId);
    if (error) setEnabled(!next);
    setSaving(false);
  }

  return (
    <label className="flex items-center gap-2 font-body text-xs text-steel cursor-pointer select-none">
      <input type="checkbox" checked={enabled} disabled={saving} onChange={toggle} className="accent-rust" />
      Youth/Team mode — protein-first, no calorie-deficit framing
    </label>
  );
}
