"use client";

import { useState } from "react";
import {
  ALLERGY_LABELS,
  CARB_SPLITS,
  CARB_SPLIT_LABELS,
  DIET_LABELS,
  DIET_TYPES,
  MAX_ALLERGY_ITEMS,
  MAX_NOTES_LENGTH,
  VARIETIES,
  VARIETY_LABELS,
  addItem,
  addOtherAllergy,
  allergyLabel,
  isControlledAllergy,
  proteinGramsForWeight,
  removeItem,
  toggleAllergy,
  type NutritionPreferences,
} from "@/lib/nutrition-preferences";
import { ALLERGEN_KEYS } from "@/lib/allergen-check";

const field = "w-full h-11 bg-graphite border border-steel/30 text-chalk px-3 font-body text-sm focus:outline-none focus:border-rust";

function ChipList({ label, hint, items, onChange, placeholder, max }: { label: string; hint?: string; items: string[]; onChange: (next: string[]) => void; placeholder: string; max?: number }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  function add() {
    const r = addItem(items, draft, max);
    setError(r.error);
    if (!r.error) {
      onChange(r.list);
      setDraft("");
    }
  }
  return (
    <div>
      <p className="font-body text-xs text-steel uppercase tracking-wide">{label}</p>
      {hint && <p className="font-body text-xs text-steel/80 mt-0.5">{hint}</p>}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1 border border-steel/30 bg-surface/40 pl-2.5 font-body text-sm text-chalk">
            {item}
            <button type="button" onClick={() => onChange(removeItem(items, item))} aria-label={`Remove ${item}`} className="w-8 h-8 flex items-center justify-center text-steel hover:text-rust">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2 mt-2">
        <input
          type="text"
          value={draft}
          maxLength={60}
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-label={`Add to ${label}`}
          className={field}
        />
        <button type="button" onClick={add} className="h-11 px-4 border border-steel/30 text-chalk font-body text-sm shrink-0">
          Add
        </button>
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// The food-preferences form. Tastes (likes, dislikes, allergies, intolerances, meals, snack, variety, notes) are edited by the client or the coach. The RULES that shape the
// numbers (diet type, protein target and floor, carb split) are shown only when `rules` is "edit" (the coach); a client sees them read-only (`rules="readonly"`).
export function FoodPreferencesEditor({
  prefs,
  onChange,
  rules,
  weightLbs,
}: {
  prefs: NutritionPreferences;
  onChange: (next: NutritionPreferences) => void;
  rules: "edit" | "readonly";
  weightLbs?: number | null;
}) {
  const [other, setOther] = useState("");
  const [otherError, setOtherError] = useState<string | null>(null);
  const set = (patch: Partial<NutritionPreferences>) => onChange({ ...prefs, ...patch });
  const grams = weightLbs ? proteinGramsForWeight(prefs, weightLbs) : null;
  const otherAllergies = prefs.allergies.filter((a) => !isControlledAllergy(a));

  return (
    <div className="space-y-5">
      <div>
        <p className="font-body text-xs text-steel uppercase tracking-wide">Allergies</p>
        <p className="font-body text-xs text-steel/80 mt-0.5">An allergy is never offered. Pick all that apply.</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {ALLERGEN_KEYS.map((key) => {
            const on = prefs.allergies.some((a) => a.toLowerCase() === key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => set({ allergies: toggleAllergy(prefs.allergies, key) })}
                className={`h-11 px-3 font-body text-sm border ${on ? "bg-rust/15 text-rust border-rust/50" : "text-steel border-steel/30"}`}
              >
                {ALLERGY_LABELS[key]}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {otherAllergies.map((a) => (
            <span key={a} className="inline-flex items-center gap-1 border border-rust/40 bg-rust/10 pl-2.5 font-body text-sm text-rust">
              {allergyLabel(a)}
              <button type="button" onClick={() => set({ allergies: prefs.allergies.filter((x) => x !== a) })} aria-label={`Remove ${allergyLabel(a)}`} className="w-8 h-8 flex items-center justify-center">
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={other}
            maxLength={55}
            placeholder="Something else (for example kiwi)"
            onChange={(e) => {
              setOther(e.target.value);
              setOtherError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const r = addOtherAllergy(prefs.allergies, other);
                setOtherError(r.error);
                if (!r.error) {
                  set({ allergies: r.list });
                  setOther("");
                }
              }
            }}
            aria-label="Add another allergy"
            className={field}
          />
          <button
            type="button"
            onClick={() => {
              const r = addOtherAllergy(prefs.allergies, other);
              setOtherError(r.error);
              if (!r.error) {
                set({ allergies: r.list });
                setOther("");
              }
            }}
            className="h-11 px-4 border border-steel/30 text-chalk font-body text-sm shrink-0"
          >
            Add
          </button>
        </div>
        {otherError && (
          <p className="font-body text-xs text-rust mt-1" role="alert">
            {otherError}
          </p>
        )}
        <p className="font-body text-xs text-steel/80 mt-1.5">Up to {MAX_ALLERGY_ITEMS}. Meals are checked for these words. &ldquo;May contain&rdquo; and cross-contact are not checked.</p>
      </div>

      <ChipList label="Intolerances" hint="Foods that disagree with them (lactose, gluten). Kept out of plans, but not treated as an allergy." items={prefs.intolerances} onChange={(intolerances) => set({ intolerances })} placeholder="For example lactose" max={20} />
      <ChipList label="Foods I like" items={prefs.likes} onChange={(likes) => set({ likes })} placeholder="For example salmon, rice, berries" />
      <ChipList label="Foods I don't like" hint="Kept out of plans." items={prefs.dislikes} onChange={(dislikes) => set({ dislikes })} placeholder="For example mushrooms, liver" />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="font-body text-xs text-steel uppercase tracking-wide">Meals per day</p>
          <div className="flex gap-1.5 mt-2" role="group" aria-label="Meals per day">
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={prefs.mealsPerDay === n}
                onClick={() => set({ mealsPerDay: n })}
                className={`w-11 h-11 font-body text-sm border ${prefs.mealsPerDay === n ? "bg-rust/15 text-rust border-rust/50" : "text-steel border-steel/30"}`}
              >
                {n}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 mt-3 font-body text-sm text-chalk min-h-[2.75rem]">
            <input type="checkbox" checked={prefs.includeSnack} onChange={(e) => set({ includeSnack: e.target.checked })} className="w-5 h-5 accent-[#D2703B]" />
            Include a snack
          </label>
        </div>
        <label className="block">
          <span className="font-body text-xs text-steel uppercase tracking-wide">Variety</span>
          <select value={prefs.variety} onChange={(e) => set({ variety: e.target.value as NutritionPreferences["variety"] })} className={`${field} mt-2`}>
            {VARIETIES.map((v) => (
              <option key={v} value={v}>
                {VARIETY_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="font-body text-xs text-steel uppercase tracking-wide">Anything else</span>
        <textarea
          value={prefs.notes}
          maxLength={MAX_NOTES_LENGTH}
          rows={3}
          onChange={(e) => set({ notes: e.target.value })}
          className="mt-2 w-full bg-graphite border border-steel/30 text-chalk p-3 font-body text-sm focus:outline-none focus:border-rust"
          placeholder="Anything about food your coach should know"
        />
        <span className="font-body text-xs text-steel/80">{prefs.notes.length}/{MAX_NOTES_LENGTH}</span>
      </label>

      <div className="border-t border-steel/20 pt-4">
        <p className="font-body text-xs text-steel uppercase tracking-wide">{rules === "edit" ? "Rules for the numbers" : "Set by your coach"}</p>
        {rules === "edit" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
            <label className="block">
              <span className="font-body text-xs text-steel">Diet type</span>
              <select value={prefs.dietType} onChange={(e) => set({ dietType: e.target.value as NutritionPreferences["dietType"] })} className={`${field} mt-1`}>
                {DIET_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {DIET_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-body text-xs text-steel">Carbs</span>
              <select value={prefs.carbSplit} onChange={(e) => set({ carbSplit: e.target.value as NutritionPreferences["carbSplit"] })} className={`${field} mt-1`}>
                {CARB_SPLITS.map((c) => (
                  <option key={c} value={c}>
                    {CARB_SPLIT_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-body text-xs text-steel">Protein target (g per pound)</span>
              <input type="number" step="0.05" min={0.6} max={1.5} value={prefs.proteinGPerLb} onChange={(e) => set({ proteinGPerLb: Number(e.target.value) })} className={`${field} mt-1`} />
              {grams && <span className="font-body text-xs text-steel/80">About {grams.targetG} g a day to aim for</span>}
            </label>
            <label className="block">
              <span className="font-body text-xs text-steel">Protein floor (g per pound)</span>
              <input type="number" step="0.05" min={0.4} max={1.5} value={prefs.proteinFloorGPerLb} onChange={(e) => set({ proteinFloorGPerLb: Number(e.target.value) })} className={`${field} mt-1`} />
              {grams && <span className="font-body text-xs text-steel/80">Below about {grams.floorG} g a day is a shortfall; between the floor and the target is a solid day</span>}
            </label>
          </div>
        ) : (
          <p className="font-body text-sm text-chalk mt-2">
            {DIET_LABELS[prefs.dietType]}. Protein: aim for about {prefs.proteinGPerLb} g per pound; a solid day is {prefs.proteinFloorGPerLb} g or more.
          </p>
        )}
      </div>
    </div>
  );
}
