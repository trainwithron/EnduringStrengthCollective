"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  RECIPE_DATABASE,
  FUNCTIONAL_CATEGORIES,
  buildMealSpecs,
  type Recipe,
  type MealSlot,
  type RecipeHelperOptions,
} from "@/lib/meal-engine";
import { fetchCustomRecipes } from "@/lib/custom-recipes";
import { mergeMealIntoPlan, type MealEntryPayload, type MealPlanRow } from "@/lib/meal-plan-assignment";
import { resolveDayMacroTarget } from "@/lib/todays-macros";
import { RECIPE_DRAG_MIME, type DraggedRecipe } from "./draggable-recipe";

const SLOTS: { slot: Exclude<MealSlot, "any">; label: string }[] = [
  { slot: "breakfast", label: "Breakfast" },
  { slot: "lunch", label: "Lunch" },
  { slot: "dinner", label: "Dinner" },
  { slot: "snack", label: "Snack" },
];

// Four always-visible drop targets in the expanded day panel
// (training_block_aware_nutrition_and_dragdrop_meal_planner_sept16.md).
// Dropping a recipe calls the SAME mergeMealIntoPlan() the generator's
// checkbox-based day picker already calls — drag is a second front door
// onto proven merge logic, not new merge behavior. Fetches the existing
// meal_plans row fresh at drop time (the month grid only carries a
// meal-count summary per day), so the merge always runs against real
// current data and never clobbers other slots already saved that day.
export function MealSlotDropZones({
  athleteId,
  groupId,
  coachId,
  date,
  assignedBySlot,
}: {
  athleteId: string;
  groupId: string;
  coachId: string;
  date: string; // "YYYY-MM-DD"
  assignedBySlot: Partial<Record<Exclude<MealSlot, "any">, string[]>>;
}) {
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[]>(RECIPE_DATABASE);
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const [savingSlot, setSavingSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCustomRecipes(coachId).then((custom) => {
      if (!cancelled) setRecipes([...custom, ...RECIPE_DATABASE]);
    });
    return () => {
      cancelled = true;
    };
  }, [coachId]);

  async function handleDrop(slot: Exclude<MealSlot, "any">, dragged: DraggedRecipe) {
    setSavingSlot(slot);
    setError(null);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSavingSlot(null);
      return;
    }

    const recipe = recipes.find((r) => r.id === dragged.recipeId);
    if (!recipe) {
      setError("Couldn't find that recipe — try dragging it again.");
      setSavingSlot(null);
      return;
    }

    const [{ data: existingRow }, { data: dailyMacrosRow }] = await Promise.all([
      supabase
        .from("meal_plans")
        .select("archetype, meal_count, include_snack, carb_cycling, rationale, macros, meals")
        .eq("athlete_id", athleteId)
        .eq("log_date", date)
        .maybeSingle(),
      supabase
        .from("daily_macros")
        .select("calories, protein_g, carbs_g, fat_g")
        .eq("athlete_id", athleteId)
        .eq("log_date", date)
        .maybeSingle(),
    ]);
    const existing = (existingRow as unknown as MealPlanRow | null) ?? null;

    // A bare drop on a day with no full plan inherits whatever the day's
    // real macro target already is (the same resolution lib/todays-macros
    // uses to decide which source wins) — never phantom/zero macros when
    // a real target exists.
    const resolved = resolveDayMacroTarget(
      dailyMacrosRow ?? null,
      (existing?.macros as Record<string, any> | null) ?? null,
      (existing?.meals as Record<string, unknown[]> | null) ?? null
    );
    const dayMacros = {
      calories: resolved?.calories ?? 0,
      protein: resolved?.proteinG ?? 0,
      carbs: resolved?.carbsG ?? 0,
      fats: resolved?.fatG ?? 0,
    };

    // Per-slot targets from the same split the generator uses. A brand-new
    // day defaults to 3 meals + snack so every one of the four zones has a
    // real spec to land in.
    const mealCount = existing?.meal_count ?? 3;
    const includeSnack = existing?.include_snack ?? true;
    const specs = buildMealSpecs(dayMacros, mealCount, includeSnack);
    const spec = specs.find((s) => s.slot === slot);
    if (!spec) {
      setError(`This day's plan has no ${slot} slot — open the meal planner to add one.`);
      setSavingSlot(null);
      return;
    }

    // Same helperOptions shape generateMealOptions builds for the
    // generator's own recipe rendering — the produce line keyed to the
    // slot's functional category, liquid-calorie shortcuts off (that's a
    // choice the full generator flow makes from the client's check-in;
    // a single dropped meal has no check-in context to justify it).
    const activeCat = FUNCTIONAL_CATEGORIES[spec.categoryIndex % FUNCTIONAL_CATEGORIES.length];
    const helperOptions: RecipeHelperOptions = {
      enableLiquid: false,
      produce: `<strong>Produce Profile (${activeCat.group}):</strong> 1-2 cups (${activeCat.produceOptions})`,
    };
    const ingredients = recipe.build(spec.proteinTarget, spec.carbsTarget, spec.fatTarget, helperOptions);
    const entry: MealEntryPayload = {
      mealId: spec.id,
      title: spec.title,
      proteinTarget: spec.proteinTarget,
      carbsTarget: spec.carbsTarget,
      fatTarget: spec.fatTarget,
      recipes: [{ recipeId: recipe.id, recipeName: recipe.name, ingredients }],
    };

    const merged = mergeMealIntoPlan(existing, "daily", entry, {
      archetype: existing?.archetype ?? "omnivore",
      mealCount,
      includeSnack,
      carbCycling: existing?.carb_cycling ?? false,
      macros: { daily: dayMacros },
    });

    const { error: saveError } = await supabase.from("meal_plans").upsert(
      {
        athlete_id: athleteId,
        group_id: groupId,
        log_date: date,
        archetype: merged.archetype,
        meal_count: merged.meal_count,
        include_snack: merged.include_snack,
        carb_cycling: merged.carb_cycling,
        rationale: merged.rationale,
        macros: merged.macros,
        meals: merged.meals,
        created_by: user.id,
      },
      { onConflict: "athlete_id,log_date" }
    );
    setSavingSlot(null);
    if (saveError) {
      setError("Couldn't save that meal — try again.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-1.5">
      {SLOTS.map(({ slot, label }) => {
        const assigned = assignedBySlot[slot] ?? [];
        const isOver = dragOverSlot === slot;
        return (
          <div
            key={slot}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(RECIPE_DRAG_MIME)) return;
              e.preventDefault();
              setDragOverSlot(slot);
            }}
            onDragLeave={() => setDragOverSlot((s) => (s === slot ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverSlot(null);
              const raw = e.dataTransfer.getData(RECIPE_DRAG_MIME);
              if (!raw) return;
              try {
                handleDrop(slot, JSON.parse(raw) as DraggedRecipe);
              } catch {
                // Malformed drag payload — ignore rather than crash the panel.
              }
            }}
            className={`border px-2 py-1.5 min-h-[36px] transition-colors ${
              isOver ? "border-rust bg-rust/10" : "border-dashed border-steel/30"
            } ${savingSlot === slot ? "opacity-50" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-body text-[11px] text-steel uppercase tracking-wide">{label}</span>
              {assigned.length === 0 && (
                <span className="font-body text-[10px] text-steel/70">drop a recipe</span>
              )}
            </div>
            {assigned.map((name) => (
              <p key={name} className="font-body text-xs text-chalk truncate">
                {name}
              </p>
            ))}
          </div>
        );
      })}
      {error && <p className="font-body text-xs text-rust">{error}</p>}
    </div>
  );
}
