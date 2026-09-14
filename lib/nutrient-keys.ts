// Canonical nutrient key vocabulary shared by usda_food_nutrients (the
// cached USDA reference table) and every read-side computation — so
// nothing downstream has to know USDA's own nutrient naming. The
// Key-12 list is the US Dietary Guidelines' "nutrients of public health
// concern" set (calorie_tracking_ux_research_and_plan.md), sanity-
// checked against real values before this build shipped.

export interface NutrientDef {
  key: string;
  label: string;
  unit: string;
  // Standard FDA Nutrition Facts label Daily Value (2,000 kcal reference
  // diet) — a general reference for the %DV bar, not personalized advice.
  dailyValue: number;
}

export const MACRO_KEYS = ["kcal", "protein_g", "carbs_g", "fat_g"] as const;

export const KEY_12_NUTRIENTS: NutrientDef[] = [
  { key: "fiber_g", label: "Fiber", unit: "g", dailyValue: 28 },
  { key: "sodium_mg", label: "Sodium", unit: "mg", dailyValue: 2300 },
  { key: "potassium_mg", label: "Potassium", unit: "mg", dailyValue: 4700 },
  { key: "calcium_mg", label: "Calcium", unit: "mg", dailyValue: 1300 },
  { key: "iron_mg", label: "Iron", unit: "mg", dailyValue: 18 },
  { key: "vitamin_d_mcg", label: "Vitamin D", unit: "mcg", dailyValue: 20 },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg", dailyValue: 420 },
  { key: "zinc_mg", label: "Zinc", unit: "mg", dailyValue: 11 },
  { key: "b12_mcg", label: "Vitamin B12", unit: "mcg", dailyValue: 2.4 },
  { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg", dailyValue: 90 },
  { key: "folate_mcg", label: "Folate", unit: "mcg", dailyValue: 400 },
  { key: "sat_fat_g", label: "Saturated Fat", unit: "g", dailyValue: 20 },
];

export function getNutrientDef(key: string): NutrientDef | undefined {
  return KEY_12_NUTRIENTS.find((n) => n.key === key);
}
