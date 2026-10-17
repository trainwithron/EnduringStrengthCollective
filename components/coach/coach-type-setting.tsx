"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { COACH_TYPES, type CoachType } from "@/lib/coach-type";

// "What do you coach?" — answered at signup, changeable here. It decides which way Add client leans first.
export function CoachTypeSetting({ profileId, initial }: { profileId: string; initial: CoachType | null }) {
  const [value, setValue] = useState<CoachType | "">(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function choose(next: CoachType) {
    const previous = value;
    setValue(next);
    setSaving(true);
    setMessage(null);
    const { error } = await createBrowserClient().from("profiles").update({ coach_type: next }).eq("id", profileId);
    setSaving(false);
    if (error) {
      setValue(previous);
      setMessage("Couldn't save that. Try again.");
      return;
    }
    setMessage("Saved.");
  }

  return (
    <div className="py-3">
      <p className="font-body text-sm text-chalk">What do you coach?</p>
      <div className="mt-2 space-y-2">
        {COACH_TYPES.map((t) => (
          <label key={t.value} className={`flex items-start gap-3 border px-3 py-2.5 cursor-pointer ${value === t.value ? "border-rust" : "border-steel/30"}`}>
            <input type="radio" name="coach-type-setting" checked={value === t.value} disabled={saving} onChange={() => void choose(t.value)} className="mt-1" />
            <span>
              <span className="block font-body text-sm text-chalk">{t.label}</span>
              <span className="block font-body text-xs text-steel">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {message && (
        <p className="font-body text-xs text-steel mt-1" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
