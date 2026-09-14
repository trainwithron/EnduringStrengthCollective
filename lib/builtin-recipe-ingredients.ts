// Structured, per-100g ingredient data for the 24 built-in
// RECIPE_DATABASE recipes (lib/meal-engine.ts), parallel to that file's
// own FOOD_DENSITY table but reshaped into RecipeIngredientDef so
// lib/recipe-scaling.ts's scaleRecipe() (already used for Recipe Hub v2
// custom recipes) can compute real ingredient grams here too.
//
// This does NOT replace or call each recipe's own build() function —
// those keep producing their exact hand-tuned display text, untouched.
// This is a second, parallel representation used only to estimate the
// Key-12 micronutrient panel for a generated meal: one dominant
// protein/carb/fat ingredient per recipe (not every conditional swap a
// recipe's build() can produce), each mappable to a real USDA food via
// builtin_ingredient_usda_mappings. Framed to the athlete as an
// estimate, same honesty standard as every other AI/estimated figure
// in this app — not a claim of exact recipe-instance precision.
import type { IngredientRole, RecipeIngredientDef } from "./recipe-scaling";

interface BuiltinIngredient {
  key: string; // matches builtin_ingredient_usda_mappings.ingredient_key
  label: string;
  role: IngredientRole;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}

// Every distinct ingredient key used below, with real per-100g macro
// density (converted from FOOD_DENSITY's per-gram/per-serving values,
// or a plain, well-known whole-food estimate for a few additions
// FOOD_DENSITY doesn't itself track, e.g. olive oil).
const INGREDIENTS: Record<string, Omit<BuiltinIngredient, "key" | "role">> = {
  chicken_breast: { label: "Chicken Breast", proteinPer100g: 23, carbsPer100g: 0, fatPer100g: 2.5 },
  ground_turkey_93_7: { label: "93/7 Ground Turkey", proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 7 },
  ground_beef_93_7: { label: "93/7 Ground Beef", proteinPer100g: 21, carbsPer100g: 0, fatPer100g: 7.5 },
  ground_beef_85_15: { label: "85/15 Ground Beef", proteinPer100g: 21, carbsPer100g: 0, fatPer100g: 15 },
  ground_beef_80_20: { label: "80/20 Ground Beef", proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 20 },
  beef_chuck_roast: { label: "Beef Chuck Roast", proteinPer100g: 21, carbsPer100g: 0, fatPer100g: 18 },
  sirloin_steak: { label: "Top Sirloin Steak", proteinPer100g: 22, carbsPer100g: 0, fatPer100g: 5.5 },
  white_fish: { label: "White Fish (Cod/Tilapia)", proteinPer100g: 18, carbsPer100g: 0, fatPer100g: 2 },
  salmon: { label: "Atlantic Salmon", proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 13 },
  beef_jerky: { label: "Beef Jerky", proteinPer100g: 55, carbsPer100g: 0, fatPer100g: 0 },
  seitan: { label: "Seitan", proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 0 },
  egg_white_liquid: { label: "Liquid Egg Whites", proteinPer100g: 11, carbsPer100g: 0, fatPer100g: 0 },
  whole_egg: { label: "Whole Eggs", proteinPer100g: 12, carbsPer100g: 0, fatPer100g: 10 },
  greek_yogurt: { label: "Plain Greek Yogurt", proteinPer100g: 10, carbsPer100g: 0, fatPer100g: 0 },
  soy_yogurt: { label: "Plain Soy Yogurt", proteinPer100g: 6, carbsPer100g: 0, fatPer100g: 0 },
  cheese_cheddar: { label: "Cheddar Cheese", proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 30 },
  whey_isolate: { label: "Whey Isolate", proteinPer100g: 75, carbsPer100g: 0, fatPer100g: 0 },
  plant_protein: { label: "Plant Protein Isolate", proteinPer100g: 75, carbsPer100g: 0, fatPer100g: 0 },
  collagen_peptides: { label: "Collagen Peptides", proteinPer100g: 90, carbsPer100g: 0, fatPer100g: 0 },
  nuts_almonds: { label: "Raw Almonds", proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 50 },
  nut_butter: { label: "Natural Nut Butter", proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 50 },
  tofu_extra_firm: { label: "Extra Firm Tofu", proteinPer100g: 8.9, carbsPer100g: 0, fatPer100g: 4.4 },
  tempeh: { label: "Tempeh", proteinPer100g: 18.7, carbsPer100g: 0, fatPer100g: 10.7 },

  jasmine_rice_dry: { label: "Jasmine White Rice (dry)", proteinPer100g: 7, carbsPer100g: 80, fatPer100g: 0 },
  cream_of_rice_dry: { label: "Cream of Rice (dry)", proteinPer100g: 0, carbsPer100g: 80, fatPer100g: 0 },
  rolled_oats: { label: "Rolled Oats", proteinPer100g: 13, carbsPer100g: 68, fatPer100g: 6 },
  potato_raw: { label: "Potato", proteinPer100g: 2, carbsPer100g: 17, fatPer100g: 0 },
  sweet_potato_raw: { label: "Sweet Potato", proteinPer100g: 0, carbsPer100g: 20, fatPer100g: 0 },
  rice_noodles_dry: { label: "Rice Noodles (dry)", proteinPer100g: 8, carbsPer100g: 75, fatPer100g: 0 },
  berries: { label: "Fresh Berries", proteinPer100g: 0, carbsPer100g: 12, fatPer100g: 0 },
  fruit_general: { label: "Fresh Fruit", proteinPer100g: 0, carbsPer100g: 15, fatPer100g: 0 },
  rice_cake: { label: "Rice Cakes", proteinPer100g: 0, carbsPer100g: 100, fatPer100g: 0 },
  sourdough_slice: { label: "Sourdough Bread", proteinPer100g: 7.5, carbsPer100g: 37.5, fatPer100g: 0 },

  avocado: { label: "Avocado", proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 15 },
  olive_oil: { label: "Olive Oil", proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 100 },
};

function ing(key: string, role: IngredientRole): BuiltinIngredient {
  const def = INGREDIENTS[key];
  return { key, role, label: def.label, proteinPer100g: def.proteinPer100g, carbsPer100g: def.carbsPer100g, fatPer100g: def.fatPer100g };
}

// One dominant protein/carb/fat ingredient per recipe (matches each
// recipe's primary named ingredients in lib/meal-engine.ts).
export const BUILTIN_RECIPE_INGREDIENTS: Record<string, BuiltinIngredient[]> = {
  b_egg_toast: [ing("egg_white_liquid", "protein_source"), ing("sourdough_slice", "carb_source"), ing("olive_oil", "fat_source")],
  b_power_oats: [ing("whey_isolate", "protein_source"), ing("rolled_oats", "carb_source"), ing("nut_butter", "fat_source")],
  b_greek_yogurt: [ing("greek_yogurt", "protein_source"), ing("cream_of_rice_dry", "carb_source"), ing("nuts_almonds", "fat_source")],
  b_vegan_tofu: [ing("tofu_extra_firm", "protein_source"), ing("sourdough_slice", "carb_source"), ing("avocado", "fat_source")],
  b_vegan_oats: [ing("plant_protein", "protein_source"), ing("rolled_oats", "carb_source"), ing("nut_butter", "fat_source")],
  b_vegan_parfait: [ing("soy_yogurt", "protein_source"), ing("cream_of_rice_dry", "carb_source"), ing("nuts_almonds", "fat_source")],
  b_carnivore_scramble: [ing("whole_egg", "protein_source"), ing("ground_beef_85_15", "fat_source")],

  l_chicken_rice: [ing("chicken_breast", "protein_source"), ing("jasmine_rice_dry", "carb_source"), ing("olive_oil", "fat_source")],
  l_turkey_potato: [ing("ground_turkey_93_7", "protein_source"), ing("potato_raw", "carb_source"), ing("avocado", "fat_source")],
  l_fish_noodles: [ing("white_fish", "protein_source"), ing("rice_noodles_dry", "carb_source"), ing("olive_oil", "fat_source")],
  l_vegan_tempeh: [ing("tempeh", "protein_source"), ing("jasmine_rice_dry", "carb_source"), ing("olive_oil", "fat_source")],
  l_vegan_seitan: [ing("seitan", "protein_source"), ing("potato_raw", "carb_source"), ing("avocado", "fat_source")],
  l_carnivore_burgers: [ing("ground_beef_80_20", "protein_source")],

  d_sirloin_sweet_potato: [ing("sirloin_steak", "protein_source"), ing("sweet_potato_raw", "carb_source"), ing("olive_oil", "fat_source")],
  d_salmon_mash: [ing("salmon", "protein_source"), ing("potato_raw", "carb_source")],
  d_beef_rice: [ing("ground_beef_93_7", "protein_source"), ing("jasmine_rice_dry", "carb_source"), ing("avocado", "fat_source")],
  d_vegan_tofu_sweet_potato: [ing("tofu_extra_firm", "protein_source"), ing("sweet_potato_raw", "carb_source"), ing("olive_oil", "fat_source")],
  d_carnivore_roast: [ing("beef_chuck_roast", "protein_source")],

  s_yogurt_berries: [ing("greek_yogurt", "protein_source"), ing("berries", "carb_source"), ing("nuts_almonds", "fat_source")],
  s_shake_ricecake: [ing("whey_isolate", "protein_source"), ing("rice_cake", "carb_source"), ing("nut_butter", "fat_source")],
  s_vegan_shake_fruit: [ing("plant_protein", "protein_source"), ing("fruit_general", "carb_source"), ing("nut_butter", "fat_source")],
  s_carnivore_jerky_eggs: [ing("whole_egg", "protein_source"), ing("beef_jerky", "fat_source")],
  s_keto_cheese_nuts: [ing("cheese_cheddar", "protein_source"), ing("nuts_almonds", "fat_source")],
  s_paleo_nuts_fruit: [ing("nuts_almonds", "fat_source"), ing("collagen_peptides", "protein_source"), ing("fruit_general", "carb_source")],
};

// Every distinct ingredient key referenced above — what the coach
// ingredient-mapping UI lists for mapping to a real USDA food.
export const ALL_BUILTIN_INGREDIENT_KEYS: string[] = Object.keys(INGREDIENTS);

export function getBuiltinIngredientLabel(key: string): string {
  return INGREDIENTS[key]?.label ?? key;
}

export function toRecipeIngredientDefs(
  recipeId: string,
  mappings: Map<string, number | null>
): RecipeIngredientDef[] {
  const items = BUILTIN_RECIPE_INGREDIENTS[recipeId] ?? [];
  return items.map((i) => ({
    id: i.key,
    label: i.label,
    role: i.role,
    proteinPer100g: i.proteinPer100g,
    carbsPer100g: i.carbsPer100g,
    fatPer100g: i.fatPer100g,
    fixedDisplayText: null,
    usdaFdcId: mappings.get(i.key) ?? null,
  }));
}
