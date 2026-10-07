"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { FoodPreferencesEditor } from "@/components/shared/food-preferences-editor";
import { preferencesToRow, type NutritionPreferences } from "@/lib/nutrition-preferences";

// The client's own food preferences ("foods I like, foods I don't, allergies"). They edit their tastes; the rules that shape their numbers are their coach's and are shown
// as text. Saved to the client's own row; the coach is told (fixed wording) when allergies or foods they don't like change.
export function NutritionPreferencesCard({ athleteId, initial }: { athleteId: string; initial: NutritionPreferences }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved);
  const summary = [
    prefs.allergies.length > 0 ? `${prefs.allergies.length} ${prefs.allergies.length === 1 ? "allergy" : "allergies"}` : null,
    prefs.dislikes.length > 0 ? `${prefs.dislikes.length} ${prefs.dislikes.length === 1 ? "food" : "foods"} you skip` : null,
    prefs.likes.length > 0 ? `${prefs.likes.length} you like` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  async function save() {
    setError(null);
    setMessage(null);
    setBusy(true);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase.from("client_nutrition_preferences").upsert(preferencesToRow(prefs, athleteId, { onlyTastes: true }), { onConflict: "athlete_id" });
    setBusy(false);
    if (saveError) {
      setError("Couldn't save. Check your connection and try again.");
      return;
    }
    setSaved(prefs);
    setMessage("Saved. Your coach can see this.");
    router.refresh();
  }

  return (
    <section className="border border-steel/20">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full flex items-center justify-between gap-3 px-4 min-h-[3.25rem] text-left">
        <span className="font-display uppercase text-sm tracking-wide">My food preferences</span>
        <span className="font-body text-xs text-steel min-w-0 truncate">{summary || "Tell your coach what you like and what to avoid"} {open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-3 border-t border-steel/15 space-y-4">
          <FoodPreferencesEditor prefs={prefs} onChange={setPrefs} rules="readonly" />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={busy || !dirty} className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
              {busy ? "Saving…" : "Save"}
            </button>
            {message && <span className="font-body text-xs text-positive">{message}</span>}
          </div>
          {error && (
            <p className="font-body text-xs text-rust" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
