// Allergen and diet tags for a template, COMPUTED from what the recipe actually contains (never stored, never typed by hand). Tags are only a speed filter: when a meal is
// chosen for a client its real lines are checked again against the client's CURRENT rules (lib/plan-preference-check), so a wrong tag cannot get a meal through.
import { ALLERGEN_KEYS, checkLines, textHasAllergen, type AllergenKey } from "@/lib/allergen-check";
import { FOOD_ARCHETYPES } from "./food-names";
import { foodKeyOf, mealIngredients } from "./macros";
import { BASE_TARGETS, familiesOfDiet, FAMILIES, type TargetFamily } from "./grid";
import { scaleTemplate } from "./scale";
import { isIngredient, type DietType, type TemplateRecipe } from "./types";

// The ingredient names of a recipe as built for a typical target of its slot (a formula may drop a small amount, so the names come from a real build). With a diet, the
// build is for that diet's own target shape (a keto client's meal is built with keto carbs), else the first shape the recipe lands on.
export function referenceNames(recipe: TemplateRecipe, diet?: DietType): string[] {
  const families: TargetFamily[] = diet ? familiesOfDiet(diet) : FAMILIES;
  for (const family of families) {
    const meal = scaleTemplate(recipe, BASE_TARGETS[family][recipe.slot]);
    if (meal) return meal.ingredients.map((i) => i.name);
  }
  // A recipe that lands nowhere on those shapes is still described, from the unscaled build at the first shape.
  const b = BASE_TARGETS[families[0]][recipe.slot];
  return mealIngredients(recipe.build(b.proteinG, b.carbsG, b.fatG)).map((i) => i.name);
}

const plainText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// The preparation text of a recipe as built for a typical target: it can name foods that are not a line (a sauce, milk to cook in, a seasoning), and an allergy does not
// care whether a food is a line or only in the method, so the tags read it too.
export function preparationText(recipe: TemplateRecipe, diet?: DietType): string {
  const families: TargetFamily[] = diet ? familiesOfDiet(diet) : FAMILIES;
  const b = BASE_TARGETS[families[0]][recipe.slot];
  return recipe
    .build(b.proteinG, b.carbsG, b.fatG)
    .filter((i) => !isIngredient(i))
    .map((i) => plainText(i.text))
    .join(" ");
}

export function templateAllergens(recipe: TemplateRecipe): AllergenKey[] {
  // Every food the recipe can print, at every shape it is served on: an allergen that appears only on a low-carb build is still an allergen of the recipe.
  const names = new Set<string>();
  for (const family of FAMILIES) {
    for (const n of referenceNames(recipe, family === "keto" ? "keto" : family === "carnivore" ? "carnivore" : "omnivore")) names.add(n);
  }
  const prep = [...new Set(FAMILIES.map((fam) => preparationText(recipe, fam === "keto" ? "keto" : fam === "carnivore" ? "carnivore" : "omnivore")))];
  const text = [recipe.name, ...names, ...prep].join(" . ");
  return ALLERGEN_KEYS.filter((key) => textHasAllergen(text, key) !== null);
}

// Why a recipe does NOT fit one of the diets it declares (an empty list = it fits). Vegetarian, vegan and pescatarian use the same rules the client screens use
// (lib/allergen-check); every diet also uses the old app's own food-by-diet table (FOOD_ARCHETYPES), which lists which diets each swappable food fits.
export function dietProblems(recipe: TemplateRecipe, diet: DietType): string[] {
  const names = referenceNames(recipe, diet);
  const problems: string[] = [];
  if (diet === "vegetarian" || diet === "vegan" || diet === "pescatarian") {
    for (const hit of checkLines([...names, preparationText(recipe, diet)], { dietType: diet })) problems.push(`${hit.line}: ${hit.matched}`);
  }
  for (const name of names) {
    const key = foodKeyOf(name);
    const fits = key ? FOOD_ARCHETYPES[key] : undefined;
    if (fits && !fits.includes(diet)) problems.push(`${name} is not listed for ${diet} in the food-by-diet table`);
  }
  return problems;
}
