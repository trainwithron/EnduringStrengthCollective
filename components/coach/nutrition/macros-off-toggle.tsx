"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// The coach's per-client "I do not set macros for this client". Off stops the "no macros set for next week" nudge on Needs attention for good; one tap turns it back on. It is not the food-tracking switch
// (that one is whether the CLIENT can log food).
export function MacrosOffToggle({ athleteId, groupId, initialOff, clientFirstName }: { athleteId: string; groupId: string; initialOff: boolean; clientFirstName: string }) {
  const router = useRouter();
  const [off, setOff] = useState(initialOff);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setSaving(true);
    setError(null);
    // Ask for the row back: row security can change zero rows without an error, and this should only say it saved when a row really changed.
    const { data, error: saveError } = await createBrowserClient().from("group_memberships").update({ coach_sets_macros: next ? false : true }).eq("group_id", groupId).eq("profile_id", athleteId).select("coach_sets_macros");
    if (saveError || !data || data.length === 0) {
      setError("That didn't save. Nothing was changed.");
    } else {
      setOff(next);
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="font-body text-sm text-steel" data-testid="macros-off-toggle">
      {off ? (
        <p className="flex flex-wrap items-center gap-x-2">
          <span>Macros are off for {clientFirstName}.</span>
          <button type="button" onClick={() => void set(false)} disabled={saving} className="min-h-11 px-1 text-rust underline underline-offset-2 disabled:opacity-40">
            Turn on
          </button>
        </p>
      ) : (
        <button type="button" onClick={() => void set(true)} disabled={saving} className="min-h-11 text-steel underline underline-offset-2 text-xs disabled:opacity-40">
          No macros for {clientFirstName}
        </button>
      )}
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
