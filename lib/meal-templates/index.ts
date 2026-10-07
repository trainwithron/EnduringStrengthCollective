// Ron's Mix & Macros recipe templates, ported. Everything the builder needs from the starter library lives here: the recipes (formulas copied unchanged), the food table,
// the scaler that lands a recipe on a slot's target, the checks, the renderer and the tags. Nothing here touches the database or the network.
import { DISABLED_TEMPLATES } from "./disabled";
import { RECIPES } from "./recipes";
import type { DietType, Slot, TemplateRecipe } from "./types";

export * from "./types";
export { FOOD_DENSITY, PER_UNIT_KEYS, UNIT_WEIGHT_G, type FoodKey } from "./food-table";
export { FOOD_ARCHETYPES, NAME_TO_KEY, EXTRA_NAME_TO_KEY, TRAINING_DAY_ONLY_KEYS } from "./food-names";
export { RECIPES } from "./recipes";
export { DISABLED_TEMPLATES } from "./disabled";
export { foodKeyOf, ingredientMacros, mealIngredients, mealMacros, type Macros } from "./macros";
export { checkTolerance, missScore, type SlotTarget, type ToleranceResult } from "./tolerance";
export { scaleTemplate, MAX_PASSES, type ScaledTemplateMeal } from "./scale";
export { renderLines, stripOunceHints, toOz } from "./render";
export { dietProblems, referenceNames, templateAllergens } from "./tags";

// The templates that may be offered (everything not on the disabled list).
export const ENABLED_TEMPLATES: TemplateRecipe[] = RECIPES.filter((r) => !(r.id in DISABLED_TEMPLATES));

// The enabled templates for one slot and diet, in the order the old app listed them.
export const templatesFor = (slot: Slot, diet: DietType): TemplateRecipe[] => ENABLED_TEMPLATES.filter((r) => r.slot === slot && r.archetypes.includes(diet));
