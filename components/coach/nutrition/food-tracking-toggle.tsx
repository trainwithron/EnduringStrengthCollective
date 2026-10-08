"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";

// The coach's per-client switch for food tracking. On by default; off for a client who does not track. The client then sees a short note instead of the food log, and
// nothing they already logged is removed.
export function FoodTrackingToggle({ athleteId, groupId, initialEnabled, clientFirstName }: { athleteId: string; groupId: string; initialEnabled: boolean; clientFirstName: string }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    setError(null);
    const { error: saveError } = await createBrowserClient().from("group_memberships").update({ food_tracking_enabled: next }).eq("group_id", groupId).eq("profile_id", athleteId);
    if (saveError) {
      setEnabled(!next);
      setError("That didn't save. The switch is back to what it was.");
    }
    setSaving(false);
  }

  return (
    <div className="border border-steel/20 p-3" data-testid="food-tracking-toggle">
      <label className="flex items-start justify-between gap-3 min-h-[44px] cursor-pointer">
        <span className="font-body text-sm text-chalk">
          Food tracking for {clientFirstName}
          <span className="block font-body text-xs text-steel mt-0.5">
            On by default. Turn it off for a client who doesn&apos;t track: they&apos;ll see a short note instead of the food log. Anything already logged stays.
          </span>
        </span>
        <input type="checkbox" checked={enabled} onChange={toggle} disabled={saving} aria-label={`Food tracking for ${clientFirstName}`} className="w-5 h-5 shrink-0 mt-0.5 accent-rust" />
      </label>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
