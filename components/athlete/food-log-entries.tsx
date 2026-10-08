"use client";

import { useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { FavoriteStar } from "./favorite-star";
import {
  MEAL_SLOTS,
  MEAL_SLOT_LABEL,
  copyRows,
  deleteEntry,
  fetchFoodLogDay,
  insertCopies,
  rescaleEntryPatch,
  updateEntry,
  type MealSlot,
} from "@/lib/food-entry";
import { servingText } from "@/lib/food-serving";
import { itemInsertRow, itemsFromEntries } from "@/lib/saved-meal";
import { checkMacros, parseNumberField } from "@/lib/food-validation";
import { addDaysToKey } from "@/lib/date-key";

// What the client logged today, by meal: each entry can be edited (the number of servings for a searched food; the name and numbers for anything else) or deleted, and a meal
// can be copied from yesterday or to another day. Planned meals ticked off from the coach's plan stay on the plan cards above; this list is the free-form log.
const isFreeForm = (e: FoodLogEntry) => e.status === "quick_log";
const slotKey = (e: FoodLogEntry): MealSlot | "other" => ((MEAL_SLOTS as readonly string[]).includes(e.mealSlot ?? "") ? (e.mealSlot as MealSlot) : "other");

export function FoodLogEntries({
  athleteId,
  groupId,
  logDate,
  entries,
  onAdded,
  onChanged,
  onDeleted,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  entries: FoodLogEntry[];
  onAdded: (added: FoodLogEntry[]) => void;
  onChanged: (entry: FoodLogEntry) => void;
  onDeleted: (id: string) => void;
}) {
  const mine = entries.filter(isFreeForm);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyFor, setCopyFor] = useState<MealSlot | "other" | null>(null);
  const [copyDate, setCopyDate] = useState(addDaysToKey(logDate, 1));
  const [saveFor, setSaveFor] = useState<MealSlot | "other" | null>(null);
  const [mealName, setMealName] = useState("");

  // Saves what is in one meal as a named meal to log again in one tap (my-foods-panel.tsx).
  async function saveAsMeal(group: FoodLogEntry[]) {
    const name = mealName.trim();
    if (busy) return;
    if (name === "") {
      setNotice("Give the meal a name.");
      return;
    }
    const items = itemsFromEntries(group);
    if (items.length === 0) {
      setNotice("There is nothing with numbers in this meal to save.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const supabase = createBrowserClient();
    const { data: meal, error: mealError } = await supabase.from("saved_meals").insert({ athlete_id: athleteId, name: name.slice(0, 120) }).select("id").single();
    if (mealError || !meal) {
      setBusy(false);
      setNotice(mealError?.message?.includes("limit of 300") ? "You have reached the limit of 300 saved meals. Delete some you no longer use." : "That didn't save. Try again.");
      return;
    }
    const { error: itemsError } = await supabase.from("saved_meal_items").insert(items.map((i) => itemInsertRow(meal.id as string, i)));
    if (itemsError) {
      // Do not leave an empty meal behind.
      await supabase.from("saved_meals").delete().eq("id", meal.id);
      setBusy(false);
      setNotice("That didn't save. Try again.");
      return;
    }
    setBusy(false);
    setSaveFor(null);
    setMealName("");
    setNotice(`Saved "${name}". Find it under My foods and saved meals.`);
  }

  async function copyFromYesterday() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const supabase = createBrowserClient();
    const yesterday = await fetchFoodLogDay(supabase, athleteId, addDaysToKey(logDate, -1));
    const rows = copyRows(yesterday, { athleteId, groupId, toDate: logDate });
    if (rows.length === 0) {
      setNotice("Nothing was logged yesterday to copy.");
      setBusy(false);
      return;
    }
    const added = await insertCopies(supabase, rows);
    setBusy(false);
    if (!added) {
      setNotice("That didn't copy. Try again.");
      return;
    }
    onAdded(added);
    setNotice(`Copied ${added.length} ${added.length === 1 ? "entry" : "entries"} from yesterday.`);
  }

  async function copyMeal(slot: MealSlot | "other", group: FoodLogEntry[]) {
    if (busy) return;
    if (!copyDate) return;
    setBusy(true);
    setNotice(null);
    const rows = copyRows(group, { athleteId, groupId, toDate: copyDate });
    const added = await insertCopies(createBrowserClient(), rows);
    setBusy(false);
    setCopyFor(null);
    if (!added) {
      setNotice("That didn't copy. Try again.");
      return;
    }
    if (copyDate === logDate) onAdded(added);
    setNotice(`Copied ${slot === "other" ? "these" : MEAL_SLOT_LABEL[slot].toLowerCase()} entries to ${copyDate}.`);
  }

  const groups: { slot: MealSlot | "other"; label: string; items: FoodLogEntry[] }[] = [
    ...MEAL_SLOTS.map((s) => ({ slot: s as MealSlot | "other", label: MEAL_SLOT_LABEL[s], items: mine.filter((e) => slotKey(e) === s) })),
    { slot: "other" as const, label: "Other", items: mine.filter((e) => slotKey(e) === "other") },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="space-y-3" data-testid="food-log-entries">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copyFromYesterday} disabled={busy} className="min-h-[44px] px-3 border border-steel/30 text-steel font-body text-xs disabled:opacity-50">
          Copy yesterday
        </button>
        {notice && <p className="font-body text-xs text-steel" role="status">{notice}</p>}
      </div>

      {groups.map((g) => (
        <section key={g.slot}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display uppercase text-xs tracking-wide text-steel">{g.label}</h3>
            <div className="flex items-center">
              <button type="button" onClick={() => { setSaveFor(saveFor === g.slot ? null : g.slot); setCopyFor(null); setMealName(g.label === "Other" ? "" : g.label); }} className="min-h-[44px] px-2 font-body text-xs text-steel underline">
                Save as a meal
              </button>
              <button type="button" onClick={() => { setCopyFor(copyFor === g.slot ? null : g.slot); setSaveFor(null); }} className="min-h-[44px] px-2 font-body text-xs text-steel underline">
                Copy to another day
              </button>
            </div>
          </div>
          {saveFor === g.slot && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <input type="text" value={mealName} onChange={(e) => setMealName(e.target.value)} maxLength={120} placeholder="Name this meal" aria-label="Meal name" className="flex-1 min-w-[10rem] min-h-[44px] bg-surface border border-steel/30 px-3 font-body text-sm text-chalk" />
              <button type="button" onClick={() => saveAsMeal(g.items)} disabled={busy} className="min-h-[44px] px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
                Save meal
              </button>
            </div>
          )}
          {copyFor === g.slot && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <input type="date" value={copyDate} onChange={(e) => setCopyDate(e.target.value)} aria-label="Copy to day" className="min-h-[44px] bg-surface border border-steel/30 px-2 font-body text-sm text-chalk" />
              <button type="button" onClick={() => copyMeal(g.slot, g.items)} disabled={busy || !copyDate} className="min-h-[44px] px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
                Copy
              </button>
            </div>
          )}
          <ul className="space-y-1.5">
            {g.items.map((e) => (
              <EntryRow key={e.id} entry={e} athleteId={athleteId} onChanged={onChanged} onDeleted={onDeleted} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EntryRow({
  entry,
  athleteId,
  onChanged,
  onDeleted,
}: {
  entry: FoodLogEntry;
  athleteId: string;
  onChanged: (entry: FoodLogEntry) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searched = !!entry.nutrients && !!entry.amountG && !!entry.servingQty;
  const [qty, setQty] = useState(String(entry.servingQty ?? 1));
  const [name, setName] = useState(entry.description ?? "");
  const [cal, setCal] = useState(String(entry.calories ?? ""));
  const [pro, setPro] = useState(String(entry.proteinG ?? ""));
  const [carb, setCarb] = useState(String(entry.carbsG ?? ""));
  const [fat, setFat] = useState(String(entry.fatG ?? ""));
  const [warning, setWarning] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setError(null);
    const supabase = createBrowserClient();
    if (searched) {
      const n = Number(qty);
      const patch = rescaleEntryPatch(entry, n);
      if (!patch) {
        setError("Enter an amount greater than zero.");
        return;
      }
      setBusy(true);
      const ok = await updateEntry(supabase, entry.id, patch);
      setBusy(false);
      if (!ok) {
        setError("That didn't save. Try again.");
        return;
      }
      onChanged({ ...entry, amountG: patch.amount_g, servingQty: patch.serving_qty, calories: patch.calories, proteinG: patch.protein_g, carbsG: patch.carbs_g, fatG: patch.fat_g, nutrients: patch.nutrients });
      setEditing(false);
      return;
    }
    const nums = { calories: parseNumberField(cal), proteinG: parseNumberField(pro), carbsG: parseNumberField(carb), fatG: parseNumberField(fat) };
    if ([nums.calories, nums.proteinG, nums.carbsG, nums.fatG].some((v) => v != null && Number.isNaN(v))) {
      setError("Use numbers only.");
      return;
    }
    const check = checkMacros(nums);
    if (check.errors.length > 0) {
      setError(check.errors[0]);
      return;
    }
    // A warning is shown once; saving again confirms it.
    if (check.warnings.length > 0 && warning !== check.warnings[0]) {
      setWarning(check.warnings[0]);
      return;
    }
    if (name.trim() === "") {
      setError("Give it a name.");
      return;
    }
    setBusy(true);
    const patch = { description: name.trim().slice(0, 160), calories: nums.calories, protein_g: nums.proteinG, carbs_g: nums.carbsG, fat_g: nums.fatG };
    const ok = await updateEntry(supabase, entry.id, patch);
    setBusy(false);
    if (!ok) {
      setError("That didn't save. Try again.");
      return;
    }
    onChanged({ ...entry, description: patch.description, calories: nums.calories, proteinG: nums.proteinG, carbsG: nums.carbsG, fatG: nums.fatG });
    setWarning(null);
    setEditing(false);
  }

  async function remove() {
    if (busy) return;
    if (!window.confirm(`Delete "${entry.description ?? "this entry"}" from your log?`)) return;
    setBusy(true);
    const ok = await deleteEntry(createBrowserClient(), entry.id);
    setBusy(false);
    if (!ok) {
      setError("That didn't delete. Try again.");
      return;
    }
    onDeleted(entry.id);
  }

  if (editing) {
    return (
      <li className="border border-steel/25 p-2.5 space-y-2">
        {searched ? (
          <label className="block">
            <span className="block font-body text-xs text-steel mb-1">
              Number of servings of {entry.servingLabel} ({servingText({ servingLabel: entry.servingLabel ?? null, servingQty: 1, amountG: (entry.amountG ?? 0) / (entry.servingQty ?? 1) })})
            </span>
            <input type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Servings" className="w-28 min-h-[44px] bg-surface border border-steel/30 px-3 font-body text-sm text-chalk" />
          </label>
        ) : (
          <>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={160} className="w-full min-h-[44px] bg-surface border border-steel/30 px-3 font-body text-sm text-chalk" />
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Calories", cal, setCal],
                ["Protein (g)", pro, setPro],
                ["Carbs (g)", carb, setCarb],
                ["Fat (g)", fat, setFat],
              ].map(([label, value, set]) => (
                <label key={label as string} className="block">
                  <span className="block font-body text-xs text-steel mb-1">{label as string}</span>
                  <input type="text" inputMode="decimal" value={value as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} aria-label={label as string} className="w-full min-h-[44px] bg-surface border border-steel/30 px-3 font-body text-sm text-chalk" />
                </label>
              ))}
            </div>
          </>
        )}
        {warning && <p className="font-body text-xs text-amber-400" role="alert">{warning}</p>}
        {error && <p className="font-body text-xs text-rust" role="alert">{error}</p>}
        <div className="flex items-center gap-2">
          <button type="button" onClick={save} disabled={busy} className="min-h-[44px] px-4 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
            {warning ? "Save anyway" : "Save"}
          </button>
          <button type="button" onClick={() => { setEditing(false); setError(null); setWarning(null); }} className="min-h-[44px] px-3 font-body text-xs text-steel">
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="border border-steel/15 p-2.5">
      <p className="font-body text-sm text-chalk">{entry.description}</p>
      {searched && <p className="font-body text-xs text-steel mt-0.5">{servingText({ servingLabel: entry.servingLabel ?? null, servingQty: entry.servingQty ?? null, amountG: entry.amountG ?? null })}</p>}
      <p className="font-body text-xs text-steel mt-0.5 [font-variant-numeric:tabular-nums]">
        {entry.calories ?? 0} kcal · {entry.proteinG ?? 0}p / {entry.carbsG ?? 0}c / {entry.fatG ?? 0}f
      </p>
      <div className="flex flex-wrap items-center gap-1 mt-1">
        <FavoriteStar profileId={athleteId} entry={entry} />
        <button type="button" onClick={() => setEditing(true)} className="min-h-[44px] px-2 font-body text-xs text-steel underline">
          Edit
        </button>
        <button type="button" onClick={remove} disabled={busy} className="min-h-[44px] px-2 font-body text-xs text-steel underline disabled:opacity-50">
          Delete
        </button>
      </div>
      {error && <p className="font-body text-xs text-rust" role="alert">{error}</p>}
    </li>
  );
}
