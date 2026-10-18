"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// The coach's per-client "no automatic nutrition suggestions". While it is on, the weekly check-in never suggests a calorie or macro change for this client, whatever the numbers say; the coach can still set
// their targets by hand or work out a starting target themselves. It is a note only the coach can read (not on the membership row the client reads). One tap turns it back on.
export function AutoSuggestOffToggle({ athleteId, groupId, initialOff, clientFirstName }: { athleteId: string; groupId: string; initialOff: boolean; clientFirstName: string }) {
  const router = useRouter();
  const [off, setOff] = useState(initialOff);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setSaving(true);
    setError(null);
    // Ask for the row back: row security can change zero rows without an error, and this should only say it saved when a row really changed.
    const { data, error: saveError } = await createBrowserClient()
      .from("client_nutrition_flags")
      .upsert({ group_id: groupId, profile_id: athleteId, auto_off: next, updated_at: new Date().toISOString() }, { onConflict: "group_id,profile_id" })
      .select("auto_off");
    if (saveError || !data || data.length === 0) {
      setError("That didn't save. Nothing was changed.");
    } else {
      setOff(next);
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="font-body text-sm text-steel" data-testid="auto-suggest-off-toggle">
      {off ? (
        <p className="flex flex-wrap items-center gap-x-2">
          <span>Automatic nutrition suggestions are off for {clientFirstName}. You still set their targets yourself.</span>
          <button type="button" onClick={() => void set(false)} disabled={saving} className="min-h-11 px-1 text-rust underline underline-offset-2 disabled:opacity-40">
            Turn on
          </button>
        </p>
      ) : (
        <button type="button" onClick={() => void set(true)} disabled={saving} className="min-h-11 text-steel underline underline-offset-2 text-xs disabled:opacity-40">
          No automatic suggestions for {clientFirstName}
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
