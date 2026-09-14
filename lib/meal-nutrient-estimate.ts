// Estimates a generated meal's Key-12 micronutrient panel from its real
// scaled ingredient grams (lib/recipe-scaling.ts's scaleRecipe, already
// used for both custom Recipe Hub v2 recipes and the built-in
// RECIPE_DATABASE via lib/builtin-recipe-ingredients.ts) and real
// per-100g USDA nutrient data for whichever ingredients a coach has
// mapped. Ingredients with no USDA mapping yet are simply skipped —
// `coveredIngredientCount`/`totalIngredientCount` let the UI say
// "partial data" honestly instead of presenting a silently-incomplete
// total as if it were whole.
import { scaleRecipe, type MacroTarget, type RecipeIngredientDef } from "./recipe-scaling";
import { KEY_12_NUTRIENTS } from "./nutrient-keys";

export interface NutrientTotals {
  [nutrientKey: string]: number;
}

export interface MealNutrientEstimate {
  totals: NutrientTotals;
  coveredIngredientCount: number;
  totalIngredientCount: number;
}

// nutrientsByFdcId: fdc_id -> { nutrient_key -> amount_per_100g }
export function estimateMealMicronutrients(
  ingredients: RecipeIngredientDef[],
  target: MacroTarget,
  nutrientsByFdcId: Map<number, Map<string, number>>
): MealNutrientEstimate {
  const scaled = scaleRecipe(ingredients, target);
  const totals: NutrientTotals = {};
  for (const n of KEY_12_NUTRIENTS) totals[n.key] = 0;

  let covered = 0;
  let total = 0;
  for (const line of scaled) {
    if (line.grams === null) continue; // fixed lines carry no macro-scaled grams
    total++;
    if (!line.usdaFdcId) continue;
    const perFood = nutrientsByFdcId.get(line.usdaFdcId);
    if (!perFood) continue;
    covered++;
    for (const n of KEY_12_NUTRIENTS) {
      const per100g = perFood.get(n.key);
      if (per100g == null) continue;
      totals[n.key] += (per100g * line.grams) / 100;
    }
  }

  return { totals, coveredIngredientCount: covered, totalIngredientCount: total };
}
