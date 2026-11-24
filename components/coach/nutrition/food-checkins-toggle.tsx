"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";

// The coach's per-client "Food check-ins: On/Off" (Nov 24). Saved on client_nutrition_flags (only the group's coaches can write it); the other switch on that row is left as it is.
export function FoodCheckinsToggle({ athleteId, groupId, initialOn, clientFirstName }: { athleteId: string; groupId: string; initialOn: boolean; clientFirstName: string }) {
  const router = useRouter();
  const [on, setOn] = useState(initialOn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setSaving(true);
    setError(null);
    // Ask for the row back: row security can change zero rows without an error, and this should only say it saved when a row really changed.
    const { data, error: saveError } = await createBrowserClient()
      .from("client_nutrition_flags")
      .upsert({ group_id: groupId, profile_id: athleteId, checkins_off: !next, updated_at: new Date().toISOString() }, { onConflict: "group_id,profile_id" })
      .select("checkins_off");
    if (saveError || !data || data.length === 0) {
      setError("That didn't save. Nothing was changed.");
    } else {
      setOn(next);
      router.refresh();
    }
    setSaving(false);
  }

  return (
    <div className="font-body text-sm text-steel" data-food-checkins-toggle>
      <p className="flex flex-wrap items-center gap-x-2">
        <span>
          Food check-ins: <strong className="font-semibold text-chalk">{on ? "On" : "Off"}</strong>.{" "}
          {on ? `When ${clientFirstName} stops logging or runs well off target, they get a short check-in from you.` : `${clientFirstName} gets no food check-ins.`}
        </span>
        <button type="button" onClick={() => void set(!on)} disabled={saving} className="min-h-11 px-1 text-rust-ink underline underline-offset-2 disabled:opacity-40">
          {on ? "Turn off" : "Turn on"}
        </button>
      </p>
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
