"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

export type AutoSuggestState = "none" | "this" | "other";

// The coach's per-client "no automatic nutrition suggestions". While it is on, the weekly check-in never suggests a calorie or macro change for this person, whatever the numbers say, in any group they belong to
// (it is a safety switch, so it follows the person, including into another coach's group). The coach can still set targets by hand or work out a starting target themselves (those suggestions are asked for, not sent).
// "this": switched on here. "other": switched on in another of their groups, which the weekly job honours here too; the coach can also switch it on for this group. Turning it back on here never lifts another group's switch.
export function AutoSuggestOffToggle({ athleteId, groupId, initialState, clientFirstName }: { athleteId: string; groupId: string; initialState: AutoSuggestState; clientFirstName: string }) {
  const router = useRouter();
  const [state, setState] = useState<AutoSuggestState>(initialState);
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
      setState(next ? "this" : "none");
      // The person may still be switched off in another group; the screen is read again to say so.
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="font-body text-sm text-steel" data-testid="auto-suggest-off-toggle">
      {state === "this" && (
        <p className="flex flex-wrap items-center gap-x-2">
          <span>Automatic nutrition suggestions are off for {clientFirstName}, in all their groups. Doesn&apos;t stop suggestions you ask for yourself.</span>
          <button type="button" onClick={() => void set(false)} disabled={saving} className="min-h-11 px-1 text-rust underline underline-offset-2 disabled:opacity-40">
            Turn on
          </button>
        </p>
      )}
      {state === "other" && (
        <p className="flex flex-wrap items-center gap-x-2">
          <span>Automatic nutrition suggestions are off for {clientFirstName} (set in another of their groups). Doesn&apos;t stop suggestions you ask for yourself.</span>
          <button type="button" onClick={() => void set(true)} disabled={saving} className="min-h-11 px-1 text-rust underline underline-offset-2 disabled:opacity-40">
            Switch off here too
          </button>
        </p>
      )}
      {state === "none" && (
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
