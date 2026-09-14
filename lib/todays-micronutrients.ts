// Server-side helper: computes today's real, coach-mappable Key-12
// micronutrient estimate across every meal in a GeneratedMeal[] plan.
// Reuses lib/meal-nutrient-estimate.ts's pure math per meal (built-in
// recipes via lib/builtin-recipe-ingredients.ts, custom Recipe Hub v2
// recipes via their own recipe_ingredients rows), then sums across the
// day. Honest about partial coverage — never presents a total that
// silently omits an unmapped ingredient's contribution as if complete.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedMeal } from "./meal-engine";
import { estimateMealMicronutrients, type NutrientTotals } from "./meal-nutrient-estimate";
import { BUILTIN_RECIPE_INGREDIENTS, toRecipeIngredientDefs } from "./builtin-recipe-ingredients";
import { KEY_12_NUTRIENTS } from "./nutrient-keys";
import type { RecipeIngredientDef } from "./recipe-scaling";

export interface DailyMicronutrientEstimate {
  totals: NutrientTotals;
  coveredIngredientCount: number;
  totalIngredientCount: number;
  hasAnyData: boolean;
}

export async function computeTodaysMicronutrients(
  supabase: SupabaseClient,
  meals: GeneratedMeal[]
): Promise<DailyMicronutrientEstimate> {
  const totals: NutrientTotals = {};
  for (const n of KEY_12_NUTRIENTS) totals[n.key] = 0;
  let coveredIngredientCount = 0;
  let totalIngredientCount = 0;

  const recipeIds = meals.map((m) => m.options[0]?.recipeId).filter((id): id is string => !!id);
  if (recipeIds.length === 0) {
    return { totals, coveredIngredientCount: 0, totalIngredientCount: 0, hasAnyData: false };
  }

  const builtinIds = recipeIds.filter((id) => id in BUILTIN_RECIPE_INGREDIENTS);
  const customIds = recipeIds.filter((id) => !(id in BUILTIN_RECIPE_INGREDIENTS));

  const [{ data: builtinMappingRows }, { data: customIngredientRows }] = await Promise.all([
    supabase.from("builtin_ingredient_usda_mappings").select("ingredient_key, usda_fdc_id"),
    customIds.length > 0
      ? supabase
          .from("recipe_ingredients")
          .select("recipe_id, id, label, role, protein_per_100g, carbs_per_100g, fat_per_100g, fixed_display_text, usda_fdc_id")
          .in("recipe_id", customIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const builtinMappings = new Map<string, number | null>(
    (builtinMappingRows ?? []).map((r) => [r.ingredient_key, r.usda_fdc_id])
  );

  const customIngredientsByRecipe = new Map<string, RecipeIngredientDef[]>();
  for (const row of customIngredientRows ?? []) {
    const list = customIngredientsByRecipe.get(row.recipe_id) ?? [];
    list.push({
      id: row.id,
      label: row.label,
      role: row.role,
      proteinPer100g: row.protein_per_100g,
      carbsPer100g: row.carbs_per_100g,
      fatPer100g: row.fat_per_100g,
      fixedDisplayText: row.fixed_display_text,
      usdaFdcId: row.usda_fdc_id,
    });
    customIngredientsByRecipe.set(row.recipe_id, list);
  }

  const allFdcIds = new Set<number>();
  for (const [, fdcId] of builtinMappings) if (fdcId) allFdcIds.add(fdcId);
  for (const list of customIngredientsByRecipe.values()) {
    for (const i of list) if (i.usdaFdcId) allFdcIds.add(i.usdaFdcId);
  }

  const nutrientsByFdcId = new Map<number, Map<string, number>>();
  if (allFdcIds.size > 0) {
    const { data: nutrientRows } = await supabase
      .from("usda_food_nutrients")
      .select("fdc_id, nutrient_key, amount_per_100g")
      .in("fdc_id", Array.from(allFdcIds));
    for (const row of nutrientRows ?? []) {
      const map = nutrientsByFdcId.get(row.fdc_id) ?? new Map<string, number>();
      map.set(row.nutrient_key, row.amount_per_100g);
      nutrientsByFdcId.set(row.fdc_id, map);
    }
  }

  for (const meal of meals) {
    const recipeId = meal.options[0]?.recipeId;
    if (!recipeId) continue;
    const ingredients = builtinIds.includes(recipeId)
      ? toRecipeIngredientDefs(recipeId, builtinMappings)
      : customIngredientsByRecipe.get(recipeId) ?? [];
    if (ingredients.length === 0) continue;

    const result = estimateMealMicronutrients(
      ingredients,
      { protein: meal.spec.proteinTarget, carbs: meal.spec.carbsTarget, fat: meal.spec.fatTarget },
      nutrientsByFdcId
    );
    for (const n of KEY_12_NUTRIENTS) totals[n.key] += result.totals[n.key];
    coveredIngredientCount += result.coveredIngredientCount;
    totalIngredientCount += result.totalIngredientCount;
  }

  return { totals, coveredIngredientCount, totalIngredientCount, hasAnyData: totalIngredientCount > 0 };
}
