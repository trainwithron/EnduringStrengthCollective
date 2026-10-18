"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// The group's "Post-workout cards and PR notices" switch (groups.post_workout_cards). The value shown is what the group does now: its own choice, or the default (off for a team-sport group, on otherwise).
// Saving always stores the explicit choice, so a later change to the default never flips a group the coach set.
export function PostWorkoutCardsToggle({ groupId, initialEnabled }: { groupId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase.from("groups").update({ post_workout_cards: next }).eq("id", groupId);
    if (saveError) {
      // Put the switch back so it shows what is really saved.
      setEnabled(!next);
      setError("That didn't save. The switch is back to what it was.");
    }
    setSaving(false);
  }

  return (
    <div className="py-1">
      <label className="flex items-center justify-between gap-3">
        <span className="font-body text-sm text-chalk">
          Post-workout cards and PR notices
          <span className="block font-body text-xs text-steel mt-0.5">Off: finishing a workout makes no feed card and no share card, new records are not announced, and the weekly milestone notices stop.</span>
        </span>
        <input type="checkbox" checked={enabled} onChange={toggle} disabled={saving} aria-label="Post-workout cards and PR notices" className="w-5 h-5 shrink-0 accent-rust" />
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
