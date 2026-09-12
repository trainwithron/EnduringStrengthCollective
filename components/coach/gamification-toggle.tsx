"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// Real per-group on/off preference for the gamified-logging thread
// (Phase 1: the obstacle-unlock mechanic, and everything else in that
// same thread going forward) — same reasoning already established for
// optional RPE/RIR fields: a real segment of any group just wants to
// log sets/reps and move on, and forcing extra visual mechanics on them
// is its own friction.
export function GamificationToggle({
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
    setEnabled(next);
    setSaving(true);
    const supabase = createBrowserClient();
    await supabase.from("groups").update({ gamification_enabled: next }).eq("id", groupId);
    setSaving(false);
  }

  return (
    <label className="flex items-center justify-between gap-3 py-1">
      <span className="font-body text-sm text-chalk">
        Gamified logging
        <span className="block font-body text-xs text-steel mt-0.5">
          Obstacle/unlock goals and other game-like touches on the logging screen
        </span>
      </span>
      <input
        type="checkbox"
        checked={enabled}
        onChange={toggle}
        disabled={saving}
        aria-label="Gamified logging"
        className="w-5 h-5 shrink-0 accent-rust"
      />
    </label>
  );
}
