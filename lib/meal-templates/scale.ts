// Scaling a template to a slot's target. The recipe's own formula (build) is called UNCHANGED; because a formula aims only at its main foods and ignores what its fixed
// sides add, the scaler checks what the meal really contains (every shown line, from the food table) and re-aims the formula at a corrected target, a few passes at
// most. A recipe that still cannot land inside the tolerance for THIS target is skipped for that slot (null), never shown.
import { mealMacros, ZERO_MACROS, type Macros } from "./macros";
import { checkTolerance, missScore, type SlotTarget } from "./tolerance";
import { isIngredient, type TemplateIngredient, type TemplateItem, type TemplateRecipe } from "./types";

export const MAX_PASSES = 8;

export interface ScaledTemplateMeal {
  recipeId: string;
  name: string;
  slot: TemplateRecipe["slot"];
  // Every line of the meal in order: preparation notes, then ingredients (blank ones removed).
  items: TemplateItem[];
  ingredients: TemplateIngredient[];
  macros: Macros;
  // How many formula passes it took (1 = the formula landed first time).
  passes: number;
}

// A formula can ask for a negative amount at an extreme target (the oats recipe at zero carbs); an amount below zero is zero, and a line with nothing to show is left out.
function normalize(items: TemplateItem[]): TemplateItem[] {
  return items
    .map((item) => (isIngredient(item) && item.qty < 0 ? { ...item, qty: 0, text: "" } : item))
    .filter((item) => item.text.trim() !== "");
}

export function scaleTemplate(recipe: TemplateRecipe, target: SlotTarget): ScaledTemplateMeal | null {
  let aim = { p: Math.max(0, target.proteinG), c: Math.max(0, target.carbsG), f: Math.max(0, target.fatG) };
  let best: { items: TemplateItem[]; macros: Macros; score: number; passes: number } | null = null;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    let items: TemplateItem[];
    try {
      items = normalize(recipe.build(aim.p, aim.c, aim.f));
    } catch {
      return null;
    }
    const { macros, unknown } = mealMacros(items);
    if (unknown.length > 0 || !Number.isFinite(macros.calories)) return null;
    const score = missScore(macros, target);
    if (!best || score < best.score) best = { items, macros, score, passes: pass };
    if (checkTolerance(macros, target).ok) break;
    // Re-aim by the amount the meal missed by (what the fixed sides added is taken off the aim, what they left out is added to it).
    aim = {
      p: Math.max(0, aim.p + (target.proteinG - macros.proteinG)),
      c: Math.max(0, aim.c + (target.carbsG - macros.carbsG)),
      f: Math.max(0, aim.f + (target.fatG - macros.fatG)),
    };
  }
  if (!best || !checkTolerance(best.macros, target).ok) return null;
  return {
    recipeId: recipe.id,
    name: recipe.name,
    slot: recipe.slot,
    items: best.items,
    ingredients: best.items.filter(isIngredient),
    macros: best.macros,
    passes: best.passes,
  };
}

export { ZERO_MACROS };
