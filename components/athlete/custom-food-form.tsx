"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { CUSTOM_FOOD_SELECT, LABEL_FIELDS, checkCustomFood, customFoodFromRow, customFoodInsertRow, emptyCustomFoodForm, type CustomFood, type CustomFoodForm, type CustomFoodRow } from "@/lib/custom-food";

// Add or change a food of your own: the numbers from its label for ONE serving, and optionally the full label. Private to you; your coach can see it. Wrong-looking numbers
// are flagged before saving (calories that do not add up from the macros, sugar above carbs) but only impossible ones block it.
export function CustomFoodFormPanel({
  athleteId,
  initial,
  barcode,
  onSaved,
  onCancel,
}: {
  athleteId: string;
  // Editing an existing food.
  initial?: CustomFood | null;
  // A scanned barcode that was not found: the form starts with it filled in.
  barcode?: string;
  onSaved: (food: CustomFood) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CustomFoodForm>(() =>
    initial
      ? {
          name: initial.name,
          brand: initial.brand ?? "",
          servingLabel: initial.servingLabel,
          servingG: initial.servingG != null ? String(initial.servingG) : "",
          calories: String(initial.calories),
          protein: String(initial.proteinG),
          carbs: String(initial.carbsG),
          fat: String(initial.fatG),
          label: Object.fromEntries(Object.entries(initial.nutrients ?? {}).map(([k, v]) => [k, String(v)])),
          barcode: initial.barcode ?? "",
        }
      : emptyCustomFoodForm(barcode ?? "")
  );
  const [showLabel, setShowLabel] = useState(!!initial?.nutrients);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const set = (patch: Partial<CustomFoodForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setWarnings([]);
  };

  async function save() {
    if (saving) return;
    setFailed(null);
    const check = checkCustomFood(form);
    setErrors(check.errors);
    if (!check.value) {
      setWarnings([]);
      return;
    }
    // Warnings are shown once; saving again confirms them.
    if (check.warnings.length > 0 && warnings.join("|") !== check.warnings.join("|")) {
      setWarnings(check.warnings);
      return;
    }
    setSaving(true);
    const supabase = createBrowserClient();
    const row = customFoodInsertRow(athleteId, check.value);
    const res = initial
      ? await supabase.from("custom_foods").update({ ...row, updated_at: new Date().toISOString() }).eq("id", initial.id).select(CUSTOM_FOOD_SELECT).single()
      : await supabase.from("custom_foods").insert(row).select(CUSTOM_FOOD_SELECT).single();
    setSaving(false);
    if (res.error || !res.data) {
      const msg = res.error?.message ?? "";
      setFailed(
        msg.includes("custom_foods_athlete_barcode_uniq") || msg.includes("duplicate key")
          ? "You already have a food with that barcode."
          : msg.includes("limit of 1,000")
            ? "You have reached the limit of 1,000 custom foods. Delete some you no longer use."
            : "That didn't save. Try again."
      );
      return;
    }
    onSaved(customFoodFromRow(res.data as unknown as CustomFoodRow));
  }

  const input = "w-full min-h-[44px] bg-surface border border-steel/30 px-3 font-body text-sm text-chalk";
  const lbl = "block font-body text-xs text-steel mb-1";
  return (
    <div className="border border-steel/20 p-3 space-y-3" data-testid="custom-food-form">
      <p className="font-body text-xs text-steel uppercase tracking-wide">{initial ? "Change this food" : "Add a food of your own"}</p>
      <label className="block">
        <span className={lbl}>Name</span>
        <input type="text" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} aria-label="Name" className={input} />
      </label>
      <label className="block">
        <span className={lbl}>Brand (optional)</span>
        <input type="text" value={form.brand} onChange={(e) => set({ brand: e.target.value })} maxLength={80} aria-label="Brand" className={input} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className={lbl}>One serving is</span>
          <input type="text" value={form.servingLabel} onChange={(e) => set({ servingLabel: e.target.value })} maxLength={80} placeholder="1 bar, 1 cup…" aria-label="Serving" className={input} />
        </label>
        <label className="block">
          <span className={lbl}>Serving weight in g (optional)</span>
          <input type="text" inputMode="decimal" value={form.servingG} onChange={(e) => set({ servingG: e.target.value })} aria-label="Serving weight in grams" className={input} />
        </label>
      </div>
      <p className="font-body text-xs text-steel">Numbers for ONE serving, from the label:</p>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["Calories", "calories"],
            ["Protein (g)", "protein"],
            ["Carbs (g)", "carbs"],
            ["Fat (g)", "fat"],
          ] as const
        ).map(([label, key]) => (
          <label key={key} className="block">
            <span className={lbl}>{label}</span>
            <input type="text" inputMode="decimal" value={form[key]} onChange={(e) => set({ [key]: e.target.value } as Partial<CustomFoodForm>)} aria-label={label} className={input} />
          </label>
        ))}
      </div>

      <button type="button" onClick={() => setShowLabel((v) => !v)} className="min-h-[44px] font-body text-xs text-steel underline">
        {showLabel ? "Hide the rest of the label" : "Add the rest of the label (fiber, sugar, sodium…)"}
      </button>
      {showLabel && (
        <div className="grid grid-cols-2 gap-2">
          {LABEL_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className={lbl}>
                {f.label} ({f.unit})
              </span>
              <input type="text" inputMode="decimal" value={form.label[f.key] ?? ""} onChange={(e) => set({ label: { ...form.label, [f.key]: e.target.value } })} aria-label={f.label} className={input} />
            </label>
          ))}
        </div>
      )}

      <label className="block">
        <span className={lbl}>Barcode (optional)</span>
        <input type="text" inputMode="numeric" value={form.barcode} onChange={(e) => set({ barcode: e.target.value.replace(/\D/g, "") })} aria-label="Barcode" className={input} />
      </label>

      {errors.length > 0 && (
        <ul className="font-body text-xs text-rust space-y-0.5" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="font-body text-xs text-amber-400 space-y-0.5" role="alert">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {failed && (
        <p className="font-body text-xs text-rust" role="alert">
          {failed}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={saving} className="min-h-[44px] px-4 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
          {saving ? "Saving…" : warnings.length > 0 ? "Save anyway" : "Save food"}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[44px] px-3 font-body text-xs text-steel">
          Cancel
        </button>
      </div>
    </div>
  );
}
