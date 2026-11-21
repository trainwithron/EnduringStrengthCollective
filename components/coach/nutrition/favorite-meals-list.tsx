"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { checked } from "@/lib/checked-write";
import { loadCoachRecipe } from "@/lib/library-data";
import { rowToPreferences } from "@/lib/nutrition-preferences";
import { addStarredToPlan, caloriesProteinLine, mealsOfPlan, STARRED_MEALS_CHANGED, type PlanMealChoiceTarget, type StarredMeal } from "@/lib/starred-meals";
import type { MealPlanRow } from "@/lib/meal-plan-assignment";
import { shortDateLabel } from "@/lib/apply-from";
import { StarMealButton } from "@/components/coach/nutrition/star-meal-button";

export interface FavoriteClient {
  id: string;
  groupId: string;
  fullName: string;
}

// The coach's starred meals, each with its calories and protein, a star to take it off, and "Add to plan": pick a client and a day, then which of that day's meals it becomes one
// more option of. Only a day that already has a meal plan can take it (the plan's targets are the coach's, never made up here), and the client's food rules are checked first.
export function FavoriteMealsList({ initialMeals, clients, todayKey }: { initialMeals: StarredMeal[]; clients: FavoriteClient[]; todayKey: string }) {
  const [meals, setMeals] = useState(initialMeals);
  const [openKey, setOpenKey] = useState<string | null>(null);

  // A meal unstarred anywhere on the page leaves the list.
  useEffect(() => {
    const changed = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; on: boolean }>).detail;
      if (d && !d.on) setMeals((prev) => prev.filter((m) => m.key !== d.key));
    };
    window.addEventListener(STARRED_MEALS_CHANGED, changed);
    return () => window.removeEventListener(STARRED_MEALS_CHANGED, changed);
  }, []);

  if (meals.length === 0) {
    return (
      <p className="font-body text-sm text-steel border border-steel/20 p-4 max-w-[70ch]" data-no-starred-meals>
        No favorite meals yet. Tap the star on any meal in Nutrition (a meal plan option, a meal from before a client&apos;s plan changed, or a meal a client logged) and it shows here.
      </p>
    );
  }

  return (
    <div className="max-w-3xl">
      <p className="font-body text-sm text-steel mb-4 max-w-[70ch]">Meals you starred, newest first. Add one to a client&apos;s plan as one more option for a meal.</p>
      <ul className="border border-steel/20 divide-y divide-steel/15" data-starred-meals>
        {meals.map((m) => (
          <li key={m.key} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <StarMealButton star={m} />
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm text-chalk break-words">{m.name}</p>
                <p className="font-body text-xs text-steel [font-variant-numeric:tabular-nums]">
                  {caloriesProteinLine(m)}
                  {m.carbsG != null && m.fatG != null ? <span> · {m.carbsG} g carbs · {m.fatG} g fat</span> : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenKey(openKey === m.key ? null : m.key)}
                aria-expanded={openKey === m.key}
                className="min-h-11 px-3 shrink-0 border border-steel/40 text-chalk font-body text-sm"
              >
                Add to plan
              </button>
            </div>
            {openKey === m.key && <AddToPlan meal={m} clients={clients} todayKey={todayKey} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

type DayState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; plan: MealPlanRow; targets: PlanMealChoiceTarget[] }
  | { kind: "no_plan" };

function AddToPlan({ meal, clients, todayKey }: { meal: StarredMeal; clients: FavoriteClient[]; todayKey: string }) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients.length === 1 ? clients[0].id : "");
  const [day, setDay] = useState(todayKey);
  const [target, setTarget] = useState("");
  const [state, setState] = useState<DayState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = clients.find((c) => c.id === clientId) ?? null;
  const first = client?.fullName.split(" ")[0] || "this client";

  // The chosen day's saved plan (its meals are what the starred meal can join).
  useEffect(() => {
    setMessage(null);
    setError(null);
    setTarget("");
    if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      setState({ kind: "idle" });
      return;
    }
    let live = true;
    setState({ kind: "loading" });
    (async () => {
      const supabase = createBrowserClient();
      const { data, error: readError } = await supabase
        .from("meal_plans")
        .select("archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals")
        .eq("athlete_id", clientId)
        .eq("log_date", day)
        .maybeSingle();
      if (!live) return;
      if (readError) return setState({ kind: "error", message: "Couldn't read that day's plan. Try again." });
      const targets = mealsOfPlan((data as MealPlanRow | null)?.meals);
      if (!data || targets.length === 0) return setState({ kind: "no_plan" });
      setState({ kind: "ready", plan: data as MealPlanRow, targets });
      if (targets.length === 1) setTarget(`${targets[0].bucket}|${targets[0].mealId}`);
    })();
    return () => {
      live = false;
    };
  }, [clientId, day]);

  async function add() {
    if (state.kind !== "ready" || !client || !target) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    const supabase = createBrowserClient();
    // The client's food rules, read now. No answer yet, or a read that failed, adds nothing (the same rule as building a plan).
    const { data: prefsRow, error: prefsError } = await supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", client.id).maybeSingle();
    if (prefsError || !prefsRow) {
      setBusy(false);
      setError(prefsError ? `Couldn't read ${first}'s food preferences, so nothing was added. Try again.` : `${first} hasn't answered the allergy question yet, so nothing can be added. Enter it under About on ${first}'s Nutrition page.`);
      return;
    }
    const prefs = rowToPreferences(prefsRow as Record<string, unknown>);
    const [bucket, mealId] = target.split("|");
    // A starred coach recipe is scaled from the recipe itself (ingredient by ingredient); any other star by its template or as a whole portion (lib/star-to-plan.ts).
    const recipeKey = typeof meal.meal.key === "string" && meal.meal.key.startsWith("r:") ? meal.meal.key.slice(2) : null;
    const coachRecipe = recipeKey ? await loadCoachRecipe(supabase, recipeKey) : null;
    const result = addStarredToPlan({
      plan: state.plan,
      bucket: bucket as "daily" | "train" | "rest",
      mealId,
      star: meal,
      rules: { allergies: prefs.allergies, intolerances: prefs.intolerances, dislikes: prefs.dislikes, dietType: prefs.dietType },
      clientFirst: first,
      coachRecipe,
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.reason);
      return;
    }
    const saved = await checked(
      supabase.from("meal_plans").update({ meals: result.row.meals, rationale: result.row.rationale }).eq("athlete_id", client.id).eq("log_date", day).select("log_date"),
      { expectRows: true, message: "Couldn't add it to the plan. Try again." }
    );
    setBusy(false);
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    const label = state.targets.find((t) => `${t.bucket}|${t.mealId}` === target)?.label ?? "the meal";
    setMessage(`Added to ${first}'s ${label} on ${shortDateLabel(day)}.`);
    setState({ kind: "ready", plan: result.row, targets: state.targets });
    router.refresh();
  }

  return (
    <div className="mt-2 mb-1 border border-steel/20 p-3 space-y-3" data-add-to-plan>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="font-body text-xs text-steel">Client</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="mt-1 w-full min-h-11 bg-graphite border border-steel/30 px-2 text-chalk font-body text-sm">
            <option value="">Pick a client</option>
            {clients.filter((c, i) => clients.findIndex((x) => x.id === c.id) === i).map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="font-body text-xs text-steel">Day</span>
          <input type="date" value={day} min={todayKey} onChange={(e) => setDay(e.target.value)} className="mt-1 w-full min-h-11 bg-graphite border border-steel/30 px-2 text-chalk font-body text-sm" />
        </label>
      </div>
      {state.kind === "loading" && <p className="font-body text-xs text-steel">Reading that day&apos;s plan…</p>}
      {state.kind === "error" && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {state.message}
        </p>
      )}
      {state.kind === "no_plan" && (
        <p className="font-body text-xs text-steel" role="status">
          {first} has no meal plan on {shortDateLabel(day)} yet. Build one in {first}&apos;s Meal plan first, then add this meal to it.
        </p>
      )}
      {state.kind === "ready" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1 min-w-[12rem]">
            <span className="font-body text-xs text-steel">Add it as an option for</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 w-full min-h-11 bg-graphite border border-steel/30 px-2 text-chalk font-body text-sm">
              <option value="">Pick a meal</option>
              {state.targets.map((t) => (
                <option key={`${t.bucket}|${t.mealId}`} value={`${t.bucket}|${t.mealId}`}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={add} disabled={busy || !target} className="min-h-11 px-5 bg-rust text-graphite font-body text-sm font-medium disabled:opacity-40">
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      )}
      {message && (
        <p className="font-body text-xs text-positive" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="font-body text-xs text-rust-ink" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
