"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { ALLERGEN_KEYS } from "@/lib/allergen-check";
import { addItem, ALLERGY_LABELS, DEFAULT_PREFERENCES, preferencesToRow, toggleAllergy } from "@/lib/nutrition-preferences";
import { runAllergyRebuild } from "@/lib/allergy-rebuild-client";

// Asked once, at the top of the client's Nutrition page, while they have never answered (no saved food answers): any food allergies or foods they avoid? It blocks nothing (the page is
// all there under it). Saving writes their own row (their tastes only, the same as My food preferences, which tells the coach); "None" saves an empty row, so it is on record that they
// were asked. If they named something that clashes with a plan already assigned, the clashing options are swapped right away (app/api/nutrition/allergy-rebuild).
export function NutritionFirstVisitPrompt({ athleteId }: { athleteId: string }) {
  const router = useRouter();
  const [allergies, setAllergies] = useState<string[]>([]);
  const [avoidText, setAvoidText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function save(none: boolean) {
    if (busy) return;
    setError(null);
    let dislikes: string[] = [];
    if (!none) {
      for (const part of avoidText.split(/[,;\n]/)) {
        const r = addItem(dislikes, part);
        if (r.error) {
          setError(r.error);
          return;
        }
        dislikes = r.list;
      }
    }
    const prefs = { ...DEFAULT_PREFERENCES, allergies: none ? [] : allergies, dislikes };
    setBusy(true);
    const supabase = createBrowserClient();
    const { error: saveError } = await supabase.from("client_nutrition_preferences").upsert(preferencesToRow(prefs, athleteId, { onlyTastes: true }), { onConflict: "athlete_id" });
    if (saveError) {
      setBusy(false);
      setError("Couldn't save. Check your connection and try again.");
      return;
    }
    const named = prefs.allergies.length > 0 || prefs.dislikes.length > 0;
    const rebuilt = named ? await runAllergyRebuild() : null;
    setBusy(false);
    setDone(
      !named
        ? "Thanks. Your coach can see it."
        : rebuilt && rebuilt.daysChanged > 0
          ? `Saved. Your meal plan was updated to leave ${prefs.allergies.length > 0 ? "those" : "them"} out.`
          : "Saved. Your coach can see it, and meals with these are never offered to you."
    );
    router.refresh();
  }

  if (done) {
    return (
      <p className="border border-positive/40 p-4 font-body text-sm text-chalk" role="status" data-first-visit-done>
        {done}
      </p>
    );
  }

  return (
    <section className="border border-rust/50 p-4 space-y-3" aria-label="Food allergies" data-first-visit-prompt>
      <h2 className="font-display uppercase text-sm tracking-wide">Any food allergies or foods you avoid?</h2>
      <p className="font-body text-xs text-steel">So your coach never plans a meal with them. Pick any that apply.</p>
      <div className="flex flex-wrap gap-1.5">
        {ALLERGEN_KEYS.map((key) => {
          const on = allergies.some((a) => a.toLowerCase() === key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => setAllergies((list) => toggleAllergy(list, key))}
              className={`h-11 px-3 font-body text-sm border ${on ? "bg-rust/15 text-rust border-rust/50" : "text-steel border-steel/30"}`}
            >
              {ALLERGY_LABELS[key]}
            </button>
          );
        })}
      </div>
      <label className="block">
        <span className="font-body text-xs text-steel">Foods you avoid (optional, separated by commas)</span>
        <input
          type="text"
          value={avoidText}
          onChange={(e) => setAvoidText(e.target.value)}
          placeholder="e.g. mushrooms, liver"
          maxLength={400}
          className="mt-1 w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust"
        />
      </label>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={() => save(false)} disabled={busy || (allergies.length === 0 && avoidText.trim() === "")} className="h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => save(true)} disabled={busy} className="h-11 px-5 border border-steel/40 text-chalk font-body text-sm disabled:opacity-40">
          None
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
