"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/client";
import { ChevronDown, ChevronUp, Trash2, Plus } from "lucide-react";
import type { IngredientRole } from "@/lib/recipe-scaling";

export interface RecipeIngredientRow {
  id: string;
  sortOrder: number;
  label: string;
  role: IngredientRole;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fixedDisplayText: string | null;
}

export interface RecipeRow {
  id: string;
  name: string;
  slot: "breakfast" | "lunch" | "dinner" | "snack" | "any";
  archetypes: string[];
  keywords: string[];
  ingredients: RecipeIngredientRow[];
}

const SLOT_OPTIONS = ["any", "breakfast", "lunch", "dinner", "snack"] as const;
const ARCHETYPE_OPTIONS = ["omnivore", "vegetarian", "vegan", "carnivore", "keto", "paleo"] as const;
const ROLE_LABELS: Record<IngredientRole, string> = {
  protein_source: "Protein source",
  carb_source: "Carb source",
  fat_source: "Fat source",
  fixed: "Fixed (doesn't scale)",
};

export function RecipeHubManager({
  initialRecipes,
}: {
  initialRecipes: RecipeRow[];
}) {
  const [recipes, setRecipes] = useState(initialRecipes);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const router = useRouter();

  async function handleAddRecipe() {
    const supabase = createBrowserClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return;

    const { data: newRecipe } = await supabase
      .from("recipes")
      .insert({
        created_by: userData.user.id,
        name: "New Recipe",
        slot: "any",
        archetypes: ["omnivore"],
        keywords: [],
      })
      .select("id, name, slot, archetypes, keywords")
      .single();

    if (!newRecipe) return;

    setRecipes((prev) => [
      { ...newRecipe, ingredients: [] },
      ...prev,
    ]);
    setExpandedId(newRecipe.id);
  }

  async function handleDeleteRecipe(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return;
    const supabase = createBrowserClient();
    await supabase.from("recipes").delete().eq("id", id);
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    router.refresh();
  }

  function handleRecipeUpdated(id: string, patch: Partial<RecipeRow>) {
    setRecipes((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={handleAddRecipe}
          className="h-9 px-4 bg-rust text-graphite font-body text-sm font-medium flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          New recipe
        </button>
      </div>

      {recipes.length === 0 ? (
        <p className="font-body text-sm text-steel py-6">
          No custom recipes yet. Add one — it&apos;ll show up as an option in the Meal Planner
          alongside the built-in recipes, scaled to whatever macros a client&apos;s plan needs.
        </p>
      ) : (
        <div className="space-y-3">
          {recipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              expanded={expandedId === recipe.id}
              onToggle={() => setExpandedId((prev) => (prev === recipe.id ? null : recipe.id))}
              onUpdated={(patch) => handleRecipeUpdated(recipe.id, patch)}
              onDelete={() => handleDeleteRecipe(recipe.id, recipe.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecipeCard({
  recipe,
  expanded,
  onToggle,
  onUpdated,
  onDelete,
}: {
  recipe: RecipeRow;
  expanded: boolean;
  onToggle: () => void;
  onUpdated: (patch: Partial<RecipeRow>) => void;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(recipe.name);
  const [keywordsDraft, setKeywordsDraft] = useState(recipe.keywords.join(", "));
  // Guards handleAddIngredient against the same race found and fixed
  // elsewhere in the builder tonight: it computes sort_order off the
  // `recipe.ingredients` closure, stale until the parent re-renders with
  // the new array — a fast double-click on "Add ingredient" would
  // otherwise insert two rows at the same sort_order.
  const [addIngredientBusy, setAddIngredientBusy] = useState(false);

  async function persistName() {
    const trimmed = nameDraft.trim() || "Untitled recipe";
    setNameDraft(trimmed);
    if (trimmed === recipe.name) return;
    const supabase = createBrowserClient();
    await supabase.from("recipes").update({ name: trimmed }).eq("id", recipe.id);
    onUpdated({ name: trimmed });
  }

  async function persistSlot(slot: RecipeRow["slot"]) {
    const supabase = createBrowserClient();
    await supabase.from("recipes").update({ slot }).eq("id", recipe.id);
    onUpdated({ slot });
  }

  async function toggleArchetype(archetype: string) {
    const next = recipe.archetypes.includes(archetype)
      ? recipe.archetypes.filter((a) => a !== archetype)
      : [...recipe.archetypes, archetype];
    if (next.length === 0) return; // must keep at least one — otherwise it can never match a plan
    const supabase = createBrowserClient();
    await supabase.from("recipes").update({ archetypes: next }).eq("id", recipe.id);
    onUpdated({ archetypes: next });
  }

  async function persistKeywords() {
    const next = keywordsDraft
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    const supabase = createBrowserClient();
    await supabase.from("recipes").update({ keywords: next }).eq("id", recipe.id);
    onUpdated({ keywords: next });
  }

  async function handleAddIngredient() {
    if (addIngredientBusy) return;
    setAddIngredientBusy(true);
    try {
      const nextOrder =
        recipe.ingredients.length > 0
          ? Math.max(...recipe.ingredients.map((i) => i.sortOrder)) + 1
          : 0;
      const supabase = createBrowserClient();
      const { data: newRow } = await supabase
        .from("recipe_ingredients")
        .insert({
          recipe_id: recipe.id,
          sort_order: nextOrder,
          label: "",
          role: "fixed",
          protein_per_100g: 0,
          carbs_per_100g: 0,
          fat_per_100g: 0,
          fixed_display_text: "",
        })
        .select("id, sort_order, label, role, protein_per_100g, carbs_per_100g, fat_per_100g, fixed_display_text")
        .single();

      if (!newRow) return;

      onUpdated({
        ingredients: [
          ...recipe.ingredients,
          {
            id: newRow.id,
            sortOrder: newRow.sort_order,
            label: newRow.label,
            role: newRow.role,
            proteinPer100g: newRow.protein_per_100g,
            carbsPer100g: newRow.carbs_per_100g,
            fatPer100g: newRow.fat_per_100g,
            fixedDisplayText: newRow.fixed_display_text,
          },
        ],
      });
    } finally {
      setAddIngredientBusy(false);
    }
  }

  function handleIngredientUpdated(id: string, patch: Partial<RecipeIngredientRow>) {
    onUpdated({
      ingredients: recipe.ingredients.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
  }

  async function handleDeleteIngredient(id: string) {
    const supabase = createBrowserClient();
    await supabase.from("recipe_ingredients").delete().eq("id", id);
    onUpdated({ ingredients: recipe.ingredients.filter((i) => i.id !== id) });
  }

  return (
    <div className="border border-steel/20 bg-surface/40">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={onToggle} className="flex-1 flex items-center gap-3 min-w-0 text-left">
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-steel shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-steel shrink-0" />
          )}
          <span className="font-body font-medium text-[15px] text-chalk truncate">{recipe.name}</span>
          <span className="font-body text-xs text-steel shrink-0">
            {recipe.slot === "any" ? "Any meal" : recipe.slot} &middot; {recipe.ingredients.length}{" "}
            {recipe.ingredients.length === 1 ? "ingredient" : "ingredients"}
          </span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${recipe.name}`}
          className="w-7 h-7 flex items-center justify-center text-steel active:text-rust transition-colors shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-steel/15 pt-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-body text-xs text-steel uppercase tracking-wide">Name</span>
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={persistName}
                className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
              />
            </label>
            <label className="block">
              <span className="font-body text-xs text-steel uppercase tracking-wide">Meal slot</span>
              <select
                value={recipe.slot}
                onChange={(e) => persistSlot(e.target.value as RecipeRow["slot"])}
                className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm"
              >
                {SLOT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s === "any" ? "Any meal" : s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              Works for (select all that apply)
            </span>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {ARCHETYPE_OPTIONS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleArchetype(a)}
                  className={`h-7 px-2.5 border font-body text-xs capitalize ${
                    recipe.archetypes.includes(a)
                      ? "border-rust text-rust"
                      : "border-steel/30 text-steel"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="font-body text-xs text-steel uppercase tracking-wide">
              Keywords (comma-separated — used to avoid dietary restrictions and match favorites)
            </span>
            <input
              type="text"
              value={keywordsDraft}
              onChange={(e) => setKeywordsDraft(e.target.value)}
              onBlur={persistKeywords}
              placeholder="chicken, rice, bowl"
              className="w-full h-9 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
            />
          </label>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-body text-xs text-steel uppercase tracking-wide">Ingredients</span>
              <button
                type="button"
                onClick={handleAddIngredient}
                disabled={addIngredientBusy}
                className="font-body text-xs text-rust flex items-center gap-1 disabled:opacity-40"
              >
                <Plus className="w-3 h-3" />
                Add ingredient
              </button>
            </div>
            <p className="font-body text-[11px] text-steel mb-2">
              Use at most one &quot;source&quot; ingredient per macro — its amount is solved directly from
              the target (e.g. protein target ÷ protein per 100g). Add as many &quot;fixed&quot; ingredients
              as you want (herbs, a fixed drizzle, produce) — they never scale.
            </p>

            {recipe.ingredients.length === 0 ? (
              <p className="font-body text-sm text-steel">No ingredients yet.</p>
            ) : (
              <div className="space-y-2">
                {recipe.ingredients.map((ing) => (
                  <IngredientEditor
                    key={ing.id}
                    ingredient={ing}
                    onUpdated={(patch) => handleIngredientUpdated(ing.id, patch)}
                    onDelete={() => handleDeleteIngredient(ing.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IngredientEditor({
  ingredient,
  onUpdated,
  onDelete,
}: {
  ingredient: RecipeIngredientRow;
  onUpdated: (patch: Partial<RecipeIngredientRow>) => void;
  onDelete: () => void;
}) {
  const [labelDraft, setLabelDraft] = useState(ingredient.label);
  const [proteinDraft, setProteinDraft] = useState(ingredient.proteinPer100g.toString());
  const [carbsDraft, setCarbsDraft] = useState(ingredient.carbsPer100g.toString());
  const [fatDraft, setFatDraft] = useState(ingredient.fatPer100g.toString());
  const [fixedTextDraft, setFixedTextDraft] = useState(ingredient.fixedDisplayText ?? "");

  async function persist(patch: Record<string, unknown>, localPatch: Partial<RecipeIngredientRow>) {
    const supabase = createBrowserClient();
    await supabase.from("recipe_ingredients").update(patch).eq("id", ingredient.id);
    onUpdated(localPatch);
  }

  return (
    <div className="border border-steel/15 p-2.5">
      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-start">
        <input
          type="text"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={() => {
            const trimmed = labelDraft.trim() || "Ingredient";
            setLabelDraft(trimmed);
            if (trimmed !== ingredient.label) persist({ label: trimmed }, { label: trimmed });
          }}
          placeholder="Chicken Breast"
          className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-sm focus:outline-none focus:border-rust"
        />
        <select
          value={ingredient.role}
          onChange={(e) => {
            const role = e.target.value as IngredientRole;
            persist({ role }, { role });
          }}
          className="h-9 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs"
        >
          {(Object.keys(ROLE_LABELS) as IngredientRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${ingredient.label || "ingredient"}`}
          className="w-9 h-9 flex items-center justify-center text-steel active:text-rust transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {ingredient.role === "fixed" ? (
        <label className="block mt-2">
          <span className="font-body text-[11px] text-steel">
            Display text (e.g. &quot;1-2 cups steamed&quot; — leave blank to show just the label)
          </span>
          <input
            type="text"
            value={fixedTextDraft}
            onChange={(e) => setFixedTextDraft(e.target.value)}
            onBlur={() => persist({ fixed_display_text: fixedTextDraft || null }, { fixedDisplayText: fixedTextDraft || null })}
            className="w-full h-8 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
          />
        </label>
      ) : (
        <div className="grid grid-cols-3 gap-2 mt-2">
          <label className="block">
            <span className="font-body text-[11px] text-steel">Protein /100g</span>
            <input
              type="number"
              value={proteinDraft}
              onChange={(e) => setProteinDraft(e.target.value)}
              onBlur={() => {
                const v = Number(proteinDraft) || 0;
                persist({ protein_per_100g: v }, { proteinPer100g: v });
              }}
              className="w-full h-8 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
            />
          </label>
          <label className="block">
            <span className="font-body text-[11px] text-steel">Carbs /100g</span>
            <input
              type="number"
              value={carbsDraft}
              onChange={(e) => setCarbsDraft(e.target.value)}
              onBlur={() => {
                const v = Number(carbsDraft) || 0;
                persist({ carbs_per_100g: v }, { carbsPer100g: v });
              }}
              className="w-full h-8 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
            />
          </label>
          <label className="block">
            <span className="font-body text-[11px] text-steel">Fat /100g</span>
            <input
              type="number"
              value={fatDraft}
              onChange={(e) => setFatDraft(e.target.value)}
              onBlur={() => {
                const v = Number(fatDraft) || 0;
                persist({ fat_per_100g: v }, { fatPer100g: v });
              }}
              className="w-full h-8 mt-1 bg-graphite border border-steel/30 text-chalk px-2 font-body text-xs focus:outline-none focus:border-rust"
            />
          </label>
        </div>
      )}
    </div>
  );
}
