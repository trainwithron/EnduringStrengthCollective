// One shape for a meal the builder can offer, whatever it came from: a starter-library recipe (code), a coach's own saved recipe (the database) or an approved AI option.
// Everything after this point (the checks, the ranking, the week, the saved plan, the client's card) reads this shape and never has to know the source.
import { ingredientGrams, ingredientMacros, type Macros } from "@/lib/meal-templates/macros";
import { isIngredient, type Slot, type TemplateRecipe } from "@/lib/meal-templates/types";
import type { ScaledTemplateMeal } from "@/lib/meal-templates/scale";
import { renderLines } from "@/lib/meal-templates/render";
import { mainProteinOf } from "@/lib/main-protein";

export type MealSource = "library" | "coach" | "ai";

// One counted line of a meal. name is the food (what the checks and the macros use); label is the line as it is printed (a recipe may print its own label), so a rule is
// checked against BOTH.
export interface ScaledLine {
  name: string;
  label: string;
  grams: number | null;
  // The real food a saved line was matched to (its USDA description), when it has one. The food rules are checked against this too, so a label that hides the food cannot pass.
  matched?: string;
}

export interface ScaledMeal {
  // Stable across days and clients: "t:<template id>" (starter library), "r:<recipe id>" (a coach's own) or "ai:<fingerprint>".
  key: string;
  source: MealSource;
  recipeId: string;
  name: string;
  slot: Slot;
  lines: ScaledLine[];
  // What the client sees, in order: the preparation notes and every counted line (HTML-ish for a library or coach meal, plain for an AI one).
  displayLines: string[];
  // The preparation text as plain words, so the checks can read it too.
  prepText: string;
  macros: Macros;
  mainProtein: string | null;
  // How far the formula was aimed from the slot's own target (a library meal), 0 for the others.
  drift: number;
  // The allergen groups a saved recipe was tagged with when it was saved (a speed filter and a second net: a recipe tagged with one of the client's allergies is never offered).
  allergenTags?: string[];
}

const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// The label a line prints: the text inside the first <strong>...:</strong>, else the food name.
export function printedLabel(text: string, fallback: string): string {
  const m = text.match(/<strong>([^<]*?)\s*:?\s*<\/strong>/i);
  const label = m?.[1]?.trim();
  return label ? label : fallback;
}

export function fromTemplateMeal(meal: ScaledTemplateMeal, recipe: TemplateRecipe, opts: { metric?: boolean } = {}): ScaledMeal {
  const lines: ScaledLine[] = [];
  const weighted: { name: string; proteinG: number }[] = [];
  for (const ing of meal.ingredients) {
    lines.push({ name: ing.name, label: printedLabel(ing.text, ing.name), grams: ingredientGrams(ing) });
    weighted.push({ name: ing.name, proteinG: ingredientMacros(ing)?.proteinG ?? 0 });
  }
  const prepText = meal.items
    .filter((i) => !isIngredient(i))
    .map((i) => plain(i.text))
    .filter(Boolean)
    .join(" ");
  return {
    key: `t:${recipe.id}`,
    source: "library",
    recipeId: recipe.id,
    name: recipe.name,
    slot: recipe.slot,
    lines,
    displayLines: renderLines(meal.items, { metric: opts.metric }),
    prepText,
    macros: meal.macros,
    mainProtein: mainProteinOf(weighted),
    drift: meal.drift,
  };
}

export const roundMacros = (m: Macros): Macros => ({
  proteinG: Math.round(m.proteinG),
  carbsG: Math.round(m.carbsG),
  fatG: Math.round(m.fatG),
  calories: Math.round(m.calories),
});

// Every piece of text the client's food rules must be checked against: the meal's name, each food's name AND printed label, and the preparation text.
export function checkTextOf(meal: Pick<ScaledMeal, "name" | "lines" | "prepText">): string[] {
  const out = [meal.name];
  for (const l of meal.lines) {
    out.push(l.name);
    if (l.label && l.label !== l.name) out.push(l.label);
    if (l.matched && l.matched !== l.name && l.matched !== l.label) out.push(l.matched);
  }
  if (meal.prepText) out.push(meal.prepText);
  return out;
}
