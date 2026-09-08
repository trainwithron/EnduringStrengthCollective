// Recipe Hub v2 — fetches a coach's own submitted recipes and adapts them
// into the exact same `Recipe` shape lib/meal-engine.ts's hardcoded
// RECIPE_DATABASE already uses, so generateMealOptions/generateFullMealPlan
// never need to know the difference between a built-in recipe and a
// custom one. The synthesized `build()` just calls scaleRecipe() — see
// lib/recipe-scaling.ts for why that math is deliberately simpler than
// the hand-tuned built-in recipes.
import { createBrowserClient } from "@/lib/supabase/client";
import type { Recipe, Archetype, MealSlot } from "./meal-engine";
import { scaleRecipe, formatIngredientLineHtml, type RecipeIngredientDef, type IngredientRole } from "./recipe-scaling";

export async function fetchCustomRecipes(coachId: string): Promise<Recipe[]> {
  const supabase = createBrowserClient();
  const { data } = await supabase
    .from("recipes")
    .select(
      "id, name, slot, archetypes, keywords, recipe_ingredients ( id, sort_order, label, role, protein_per_100g, carbs_per_100g, fat_per_100g, fixed_display_text )"
    )
    .eq("created_by", coachId);

  return (data ?? []).map((r: any) => {
    const ingredients: RecipeIngredientDef[] = (r.recipe_ingredients ?? [])
      .slice()
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((i: any) => ({
        id: i.id,
        label: i.label,
        role: i.role as IngredientRole,
        proteinPer100g: i.protein_per_100g,
        carbsPer100g: i.carbs_per_100g,
        fatPer100g: i.fat_per_100g,
        fixedDisplayText: i.fixed_display_text,
      }));

    const recipe: Recipe = {
      id: r.id,
      name: r.name,
      slot: r.slot as MealSlot,
      archetype: (r.archetypes ?? ["omnivore"]) as Archetype[],
      keywords: r.keywords ?? [],
      build: (p, c, f) =>
        scaleRecipe(ingredients, { protein: p, carbs: c, fat: f }).map(formatIngredientLineHtml),
    };
    return recipe;
  });
}
