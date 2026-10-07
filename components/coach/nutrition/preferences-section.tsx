"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { FoodPreferencesEditor } from "@/components/shared/food-preferences-editor";
import { preferencesToRow, validateProteinSettings, type NutritionPreferences } from "@/lib/nutrition-preferences";

// The coach's view of one client's food preferences and protein rules. Saved straight to the client's row (one per CLIENT, so every coach of that client sees it).
export function PreferencesSection({
  athleteId,
  initial,
  weightLbs,
  updatedByName,
  updatedAtLabel,
  clientName,
}: {
  athleteId: string;
  initial: NutritionPreferences;
  weightLbs: number | null;
  updatedByName: string | null;
  updatedAtLabel: string | null;
  clientName: string;
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);

  async function save() {
    setError(null);
    setMessage(null);
    const problem = validateProteinSettings(prefs.proteinGPerLb, prefs.proteinFloorGPerLb);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase.from("client_nutrition_preferences").upsert(preferencesToRow(prefs, athleteId), { onConflict: "athlete_id" });
    setBusy(false);
    if (saveError) {
      setError("Couldn't save. Check your connection and try again.");
      return;
    }
    setSaved(prefs);
    setMessage("Saved. New plans use this; plans already assigned are checked against it and flagged below if they conflict.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="font-body text-xs text-steel max-w-[70ch]">
        {clientName} can edit their own foods and allergies; the diet type, protein and carb rules are yours. {updatedByName && updatedAtLabel ? `Last changed by ${updatedByName} on ${updatedAtLabel}.` : "Nothing saved yet."}
      </p>
      <FoodPreferencesEditor prefs={prefs} onChange={setPrefs} rules="edit" weightLbs={weightLbs} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy || !dirty} className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Saving…" : "Save preferences"}
        </button>
        {message && <span className="font-body text-xs text-positive">{message}</span>}
      </div>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
