"use client";

import { confirmDialog } from "@/components/shared/confirm-dialog";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { FoodLogEntry } from "./meal-checkoff-list";
import { CustomFoodFormPanel } from "./custom-food-form";
import { CUSTOM_FOOD_SELECT, customFoodEntryProblem, customFoodEntryRow, customFoodFromRow, customFoodTitle, servingsProblem, type CustomFood, type CustomFoodRow } from "@/lib/custom-food";
import { MEAL_SLOTS, MEAL_SLOT_LABEL, FOOD_LOG_DETAIL_SELECT, defaultMealSlot, entryFromRow, insertCopies, type FoodLogRow, type MealSlot } from "@/lib/food-entry";
import { SAVED_MEAL_ITEM_SELECT, itemFromRow, mealEntryProblem, mealEntryRows, mealServingsProblem, mealTotals, type SavedMeal, type SavedMealItemRow } from "@/lib/saved-meal";

// "My foods": the foods the client made themselves and the meals they saved, each logged in one tap at any number of servings. Free, instant, no AI.
export function MyFoodsPanel({ athleteId, groupId, logDate, onLogged }: { athleteId: string; groupId: string; logDate: string; onLogged: (entries: FoodLogEntry[]) => void }) {
  const [open, setOpen] = useState(false);
  const [foods, setFoods] = useState<CustomFood[] | null>(null);
  const [meals, setMeals] = useState<SavedMeal[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CustomFood | "new" | null>(null);
  const [slot, setSlot] = useState<MealSlot>(() => defaultMealSlot(new Date().getHours(), new Date().getMinutes()));
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open || foods) return;
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const [f, m] = await Promise.all([
        supabase.from("custom_foods").select(CUSTOM_FOOD_SELECT).eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(300),
        supabase.from("saved_meals").select(`id, name, saved_meal_items ( ${SAVED_MEAL_ITEM_SELECT} )`).eq("athlete_id", athleteId).order("created_at", { ascending: false }).limit(100),
      ]);
      if (cancelled) return;
      if (f.error || m.error) {
        setLoadError(true);
        setFoods([]);
        setMeals([]);
        return;
      }
      setFoods(((f.data ?? []) as unknown as CustomFoodRow[]).map(customFoodFromRow));
      setMeals(
        ((m.data ?? []) as unknown as { id: string; name: string; saved_meal_items: SavedMealItemRow[] }[]).map((x) => ({
          id: x.id,
          name: x.name,
          items: (x.saved_meal_items ?? []).map(itemFromRow).sort((a, b) => a.position - b.position),
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, foods, athleteId]);

  const q = query.trim().toLowerCase();
  const shownFoods = useMemo(() => (foods ?? []).filter((f) => q === "" || customFoodTitle(f).toLowerCase().includes(q)), [foods, q]);
  const shownMeals = useMemo(() => (meals ?? []).filter((m) => q === "" || m.name.toLowerCase().includes(q)), [meals, q]);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full min-h-[44px] border border-steel/30 text-steel font-body text-sm active:border-rust active:text-rust transition-colors">
        My foods and saved meals
      </button>
    );
  }

  return (
    <div className="border border-steel/20 p-3 space-y-3" data-testid="my-foods">
      <div className="flex items-center justify-between gap-3">
        <p className="font-body text-xs text-steel uppercase tracking-wide">My foods and saved meals</p>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] px-2 font-body text-xs text-steel">
          Close
        </button>
      </div>

      {editing ? (
        <CustomFoodFormPanel
          athleteId={athleteId}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={(food) => {
            setFoods((prev) => [food, ...(prev ?? []).filter((x) => x.id !== food.id)]);
            setEditing(null);
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find one of yours" aria-label="Find one of your foods or meals" className="flex-1 min-w-[10rem] min-h-[44px] bg-surface border border-steel/30 px-3 font-body text-sm text-chalk" />
            <label className="block">
              <span className="sr-only">Meal</span>
              <select value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} aria-label="Meal" className="min-h-[44px] bg-surface border border-steel/30 px-2 font-body text-sm text-chalk">
                {MEAL_SLOTS.map((s) => (
                  <option key={s} value={s}>
                    {MEAL_SLOT_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {notice && <p className="font-body text-xs text-rust" role="status">{notice}</p>}
          {loadError && <p className="font-body text-xs text-rust" role="alert">Couldn&apos;t load your foods. Try again in a moment.</p>}

          <section>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-display uppercase text-xs tracking-wide text-steel">My foods</h3>
              <button type="button" onClick={() => setEditing("new")} className="min-h-[44px] px-2 font-body text-xs text-rust underline">
                Add a food
              </button>
            </div>
            {foods == null ? (
              <p className="font-body text-xs text-steel">Loading…</p>
            ) : shownFoods.length === 0 ? (
              <p className="font-body text-xs text-steel">{(foods ?? []).length === 0 ? "No foods of your own yet. Add one with the numbers from its label." : "Nothing matches that."}</p>
            ) : (
              <ul className="space-y-1.5">
                {shownFoods.map((f) => (
                  <CustomFoodRowItem key={f.id} food={f} athleteId={athleteId} groupId={groupId} logDate={logDate} slot={slot} onLogged={(e) => { onLogged([e]); setNotice(`${customFoodTitle(f)} added to ${MEAL_SLOT_LABEL[slot].toLowerCase()}.`); }} onEdit={() => setEditing(f)} onDeleted={() => setFoods((prev) => (prev ?? []).filter((x) => x.id !== f.id))} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="font-display uppercase text-xs tracking-wide text-steel">Saved meals</h3>
            {meals == null ? (
              <p className="font-body text-xs text-steel">Loading…</p>
            ) : shownMeals.length === 0 ? (
              <p className="font-body text-xs text-steel">{(meals ?? []).length === 0 ? "No saved meals yet. Log a meal, then choose Save as a meal on it." : "Nothing matches that."}</p>
            ) : (
              <ul className="space-y-1.5">
                {shownMeals.map((m) => (
                  <SavedMealRowItem key={m.id} meal={m} athleteId={athleteId} groupId={groupId} logDate={logDate} slot={slot} onLogged={(es) => { onLogged(es); setNotice(`${m.name} added to ${MEAL_SLOT_LABEL[slot].toLowerCase()}.`); }} onDeleted={() => setMeals((prev) => (prev ?? []).filter((x) => x.id !== m.id))} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function CustomFoodRowItem({ food, athleteId, groupId, logDate, slot, onLogged, onEdit, onDeleted }: { food: CustomFood; athleteId: string; groupId: string; logDate: string; slot: MealSlot; onLogged: (e: FoodLogEntry) => void; onEdit: () => void; onDeleted: () => void }) {
  const [qty, setQty] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(qty);
  const problem = servingsProblem(n);

  async function log() {
    if (busy || problem) return;
    const tooBig = customFoodEntryProblem(food, n);
    if (tooBig) {
      setError(tooBig);
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: e } = await createBrowserClient().from("food_log_entries").insert(customFoodEntryRow({ athleteId, groupId, logDate, mealSlot: slot, food, qty: n })).select(FOOD_LOG_DETAIL_SELECT).single();
    setBusy(false);
    if (e || !data) {
      setError("That didn't save. Try again.");
      return;
    }
    onLogged(entryFromRow(data as unknown as FoodLogRow));
  }
  async function remove() {
    if (busy || !await confirmDialog(`Delete "${customFoodTitle(food)}"? What you already logged from it stays in your log.`)) return;
    setBusy(true);
    const { error: e } = await createBrowserClient().from("custom_foods").delete().eq("id", food.id);
    setBusy(false);
    if (e) {
      setError("That didn't delete. Try again.");
      return;
    }
    onDeleted();
  }

  return (
    <li className="border border-steel/15 p-2.5">
      <p className="font-body text-sm text-chalk">{customFoodTitle(food)}</p>
      <p className="font-body text-xs text-steel mt-0.5 [font-variant-numeric:tabular-nums]">
        Per {food.servingLabel}: {Math.round(food.calories)} kcal · {food.proteinG}p / {food.carbsG}c / {food.fatG}f
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-1.5">
        <input type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="Servings" className="w-20 min-h-[44px] bg-surface border border-steel/30 px-2 font-body text-sm text-chalk" />
        <button type="button" onClick={log} disabled={busy || !!problem} className="min-h-[44px] px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
          Log {qty || "0"} {Number(qty) === 1 ? "serving" : "servings"}
        </button>
        <button type="button" onClick={onEdit} className="min-h-[44px] px-2 font-body text-xs text-steel underline">Edit</button>
        <button type="button" onClick={remove} disabled={busy} className="min-h-[44px] px-2 font-body text-xs text-steel underline disabled:opacity-50">Delete</button>
      </div>
      {(problem && qty !== "") && <p className="font-body text-xs text-rust">{problem}</p>}
      {error && <p className="font-body text-xs text-rust" role="alert">{error}</p>}
    </li>
  );
}

function SavedMealRowItem({ meal, athleteId, groupId, logDate, slot, onLogged, onDeleted }: { meal: SavedMeal; athleteId: string; groupId: string; logDate: string; slot: MealSlot; onLogged: (e: FoodLogEntry[]) => void; onDeleted: () => void }) {
  const [servings, setServings] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(servings);
  const problem = mealServingsProblem(n);
  const totals = mealTotals(meal.items, problem ? 1 : n);

  async function log() {
    if (busy || problem) return;
    const tooBig = mealEntryProblem(meal, n);
    if (tooBig) {
      setError(tooBig);
      return;
    }
    setBusy(true);
    setError(null);
    const added = await insertCopies(createBrowserClient(), mealEntryRows({ athleteId, groupId, logDate, mealSlot: slot, meal, servings: n }));
    setBusy(false);
    if (!added) {
      setError("That didn't save. Try again.");
      return;
    }
    onLogged(added);
  }
  async function remove() {
    if (busy || !await confirmDialog(`Delete the saved meal "${meal.name}"? What you already logged from it stays in your log.`)) return;
    setBusy(true);
    const { error: e } = await createBrowserClient().from("saved_meals").delete().eq("id", meal.id);
    setBusy(false);
    if (e) {
      setError("That didn't delete. Try again.");
      return;
    }
    onDeleted();
  }

  return (
    <li className="border border-steel/15 p-2.5">
      <p className="font-body text-sm text-chalk">{meal.name}</p>
      <p className="font-body text-xs text-steel mt-0.5">{meal.items.map((i) => i.name).join(", ")}</p>
      <p className="font-body text-xs text-steel mt-0.5 [font-variant-numeric:tabular-nums]">
        {totals.calories} kcal · {totals.proteinG}p / {totals.carbsG}c / {totals.fatG}f{problem ? "" : n === 1 ? "" : ` (${n} servings)`}
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-1.5">
        <input type="number" inputMode="decimal" min="0" step="any" value={servings} onChange={(e) => setServings(e.target.value)} aria-label="Servings of this meal" className="w-20 min-h-[44px] bg-surface border border-steel/30 px-2 font-body text-sm text-chalk" />
        <button type="button" onClick={log} disabled={busy || !!problem} className="min-h-[44px] px-3 bg-rust text-graphite font-body text-xs font-medium disabled:opacity-40">
          Log this meal
        </button>
        <button type="button" onClick={remove} disabled={busy} className="min-h-[44px] px-2 font-body text-xs text-steel underline disabled:opacity-50">Delete</button>
      </div>
      {(problem && servings !== "") && <p className="font-body text-xs text-rust">{problem}</p>}
      {error && <p className="font-body text-xs text-rust" role="alert">{error}</p>}
    </li>
  );
}
