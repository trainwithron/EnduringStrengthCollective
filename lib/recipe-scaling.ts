// Recipe Hub v2: scales a coach-submitted recipe to hit a target
// protein/carbs/fat split. Deliberately simpler than the hand-tuned
// RECIPE_DATABASE builders in lib/meal-engine.ts (which juggle multiple
// interacting ingredient swaps per macro, e.g. picking a different fruit
// once carbs drop below a threshold) — a generic algorithm can't replicate
// that bespoke intelligence for an arbitrary submitted recipe. Instead:
// at most one adjustable ingredient per macro role, solved directly from
// the target and its per-100g density. Fixed ingredients (herbs, a fixed
// produce line) never scale and always render their configured text as-is.

export type IngredientRole = "protein_source" | "carb_source" | "fat_source" | "fixed";

export interface RecipeIngredientDef {
  id: string;
  label: string;
  role: IngredientRole;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  // Only meaningful when role === "fixed" — a static line with no macro
  // math, e.g. "1-2 cups steamed vegetables".
  fixedDisplayText: string | null;
}

export interface ScaledIngredientLine {
  ingredientId: string;
  label: string;
  role: IngredientRole;
  grams: number | null; // null for fixed ingredients
  displayText: string;
  fixedDisplayText: string | null;
}

export interface MacroTarget {
  protein: number;
  carbs: number;
  fat: number;
}

function gramsToOz(grams: number): string {
  return (grams / 28.35).toFixed(1);
}

const DENSITY_PER_ROLE: Record<
  Exclude<IngredientRole, "fixed">,
  (i: RecipeIngredientDef) => number
> = {
  protein_source: (i) => i.proteinPer100g,
  carb_source: (i) => i.carbsPer100g,
  fat_source: (i) => i.fatPer100g,
};

const TARGET_KEY_PER_ROLE: Record<Exclude<IngredientRole, "fixed">, keyof MacroTarget> = {
  protein_source: "protein",
  carb_source: "carbs",
  fat_source: "fat",
};

// Matches the "<strong>Label:</strong> value" convention every hand-built
// RECIPE_DATABASE entry already uses, so a custom recipe's ingredient list
// reads identically to a built-in one once both are rendered as HTML.
export function formatIngredientLineHtml(line: ScaledIngredientLine): string {
  if (line.grams === null) {
    return line.fixedDisplayText
      ? `<strong>${line.label}:</strong> ${line.fixedDisplayText}`
      : `<strong>${line.label}</strong>`;
  }
  return `<strong>${line.label}:</strong> ${line.grams}g (~${gramsToOz(line.grams)} oz)`;
}

export function scaleRecipe(
  ingredients: RecipeIngredientDef[],
  target: MacroTarget
): ScaledIngredientLine[] {
  return ingredients.map((ing) => {
    if (ing.role === "fixed") {
      return {
        ingredientId: ing.id,
        label: ing.label,
        role: ing.role,
        grams: null,
        displayText: ing.fixedDisplayText ? `${ing.label}: ${ing.fixedDisplayText}` : ing.label,
        fixedDisplayText: ing.fixedDisplayText,
      };
    }

    const densityPer100g = DENSITY_PER_ROLE[ing.role](ing);
    const targetGrams = target[TARGET_KEY_PER_ROLE[ing.role]];
    const grams = densityPer100g > 0 ? Math.max(0, Math.round((targetGrams / densityPer100g) * 100)) : 0;

    return {
      ingredientId: ing.id,
      label: ing.label,
      role: ing.role,
      grams,
      displayText: `${ing.label}: ${grams}g (~${gramsToOz(grams)} oz)`,
      fixedDisplayText: null,
    };
  });
}
