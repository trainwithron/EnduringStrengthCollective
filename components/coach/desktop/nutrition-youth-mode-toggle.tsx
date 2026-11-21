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
  groupName = null,
}: {
  groupId: string;
  initialEnabled: boolean;
  // The group it changes, named on the switch (DK7, Nov 21).
  groupName?: string | null;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    setError(null);
    setEnabled(next);
    const supabase = createBrowserClient();
    const { error } = await supabase.from("groups").update({ nutrition_youth_mode: next }).eq("id", groupId);
    if (error) {
      setEnabled(!next);
      setError("That didn't save. The setting is back where it was. Try again.");
    }
    setSaving(false);
  }

  return (
    <div>
      <label className="flex items-center gap-2 font-body text-xs text-steel cursor-pointer select-none">
        <input type="checkbox" checked={enabled} disabled={saving} onChange={toggle} className="accent-rust" />
        Youth/Team mode{groupName ? ` for ${groupName}` : ""} — protein-first, no calorie-deficit framing
      </label>
      {error && (
        <p className="font-body text-xs text-rust-ink mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
