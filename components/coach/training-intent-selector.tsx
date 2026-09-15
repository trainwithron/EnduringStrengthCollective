"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { TRAINING_INTENTS, type TrainingIntent } from "@/lib/training-intent";
import { flashSaved, flashSaveError } from "@/lib/save-toast";

// Always visible and directly editable regardless of how it was set —
// smart-defaulted from the program name at creation (training-intent.ts),
// but never a silent/invisible guess a coach can't see or correct. Same
// self-contained persist pattern as program-schedule-settings.tsx.
export function TrainingIntentSelector({
  programId,
  initialIntent,
  onChange,
}: {
  programId: string;
  initialIntent: TrainingIntent | null;
  onChange: (next: TrainingIntent | null) => void;
}) {
  const [intent, setIntent] = useState<TrainingIntent | null>(initialIntent);
  const [saving, setSaving] = useState(false);

  async function handleChange(next: TrainingIntent | null) {
    const previous = intent;
    setIntent(next);
    setSaving(true);
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("programs")
      .update({ training_intent: next })
      .eq("id", programId);
    setSaving(false);
    if (error) {
      setIntent(previous);
      flashSaveError("Couldn't save the training intent — try again.");
      return;
    }
    onChange(next);
    flashSaved();
  }

  return (
    <label className="flex items-center gap-2">
      <span className="font-body text-[11px] text-steel uppercase tracking-wide">
        Training intent
      </span>
      <select
        value={intent ?? ""}
        onChange={(e) => handleChange((e.target.value || null) as TrainingIntent | null)}
        disabled={saving}
        className="h-8 px-2 bg-surface border border-steel/30 text-chalk font-body text-xs disabled:opacity-40"
      >
        <option value="">Not set</option>
        {TRAINING_INTENTS.map((i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
    </label>
  );
}
