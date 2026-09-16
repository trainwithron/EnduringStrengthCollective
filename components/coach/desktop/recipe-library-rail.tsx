"use client";

import { useEffect, useMemo, useState } from "react";
import { RECIPE_DATABASE, type Recipe, type MealSlot } from "@/lib/meal-engine";
import { fetchCustomRecipes } from "@/lib/custom-recipes";
import { DraggableRecipe } from "./draggable-recipe";

const SLOT_FILTERS: { value: MealSlot | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

// The drag SOURCE for the meal-slot drop zones — the coach's own recipes
// (Recipe Hub v2, fetchCustomRecipes) pooled with the built-in
// RECIPE_DATABASE, exactly the same pool MealPlanGenerator already draws
// from. Sits in the month page's right rail next to ProgramDayDragList,
// its workout-drag sibling. Custom recipes list first so a coach's own
// work isn't buried under the built-ins.
export function RecipeLibraryRail({ coachId }: { coachId: string }) {
  const [custom, setCustom] = useState<Recipe[]>([]);
  const [filter, setFilter] = useState<MealSlot | "all">("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchCustomRecipes(coachId).then((rows) => {
      if (!cancelled) setCustom(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [coachId]);

  const visible = useMemo(() => {
    const pool = [...custom, ...RECIPE_DATABASE];
    const q = query.trim().toLowerCase();
    return pool.filter((r) => {
      if (filter !== "all" && r.slot !== filter && r.slot !== "any") return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.keywords.some((k) => k.includes(q))) return false;
      return true;
    });
  }, [custom, filter, query]);

  const customIds = useMemo(() => new Set(custom.map((r) => r.id)), [custom]);

  return (
    <div className="border border-steel/20 p-3">
      <p className="font-body text-[11px] text-steel uppercase tracking-wide font-bold mb-2">
        Recipe library
      </p>
      <p className="font-body text-[10px] text-steel mb-2">
        Drag a recipe onto a meal slot in an expanded day.
      </p>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search recipes"
        className="w-full h-8 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs mb-2 focus:outline-none focus:border-rust"
      />
      <div className="flex flex-wrap gap-1 mb-2">
        {SLOT_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={`font-body text-[10px] uppercase tracking-wide px-2 py-0.5 border ${
              filter === f.value ? "border-rust text-rust" : "border-steel/30 text-steel"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="max-h-[360px] overflow-y-auto space-y-1 pr-1">
        {visible.length === 0 ? (
          <p className="font-body text-xs text-steel">No recipes match.</p>
        ) : (
          visible.map((r) => (
            <DraggableRecipe
              key={r.id}
              recipe={{ recipeId: r.id, recipeName: r.name, slot: r.slot }}
              className="border border-steel/20 px-2 py-1.5 hover:border-steel/50"
            >
              <p className="font-body text-xs text-chalk leading-tight">{r.name}</p>
              <p className="font-body text-[10px] text-steel">
                {r.slot === "any" ? "any meal" : r.slot}
                {customIds.has(r.id) ? " · yours" : ""}
              </p>
            </DraggableRecipe>
          ))
        )}
      </div>
    </div>
  );
}
