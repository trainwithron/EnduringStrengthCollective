// A starred meal scaled to ONE meal of a client's plan (Favorite meals' "Add to plan", Ron Nov 21): the same scaling the builder uses (lib/starred-in-plans.ts), aimed at that meal's
// own target. A starter-library star goes through its template and a coach recipe through the recipe scaler, ingredient by ingredient; a star they cannot scale (or one with no
// amounts) goes in as a whole portion ("1¼ servings"). Pure.
import { ENABLED_TEMPLATES } from "@/lib/meal-templates";
import { scaleTemplate } from "@/lib/meal-templates/scale";
import type { SlotTarget } from "@/lib/meal-templates/tolerance";
import { fromTemplateMeal, type ScaledMeal } from "@/lib/scaled-meal";
import { scaleLibraryRecipe, type LibraryRecipe } from "@/lib/library-scaling";
import { choiceFromOption, optionFromScaled } from "@/lib/library-meal-plan";
import type { MealRecipeChoice } from "@/lib/meal-plan-assignment";
import { portionStarMeal, starBuilderKey } from "@/lib/starred-in-plans";
import type { StarredMeal } from "@/lib/starred-meals";

export function scaleStarForMeal(star: StarredMeal, target: SlotTarget, coachRecipe?: LibraryRecipe | null): ScaledMeal | null {
  const key = starBuilderKey(star);
  if (key?.startsWith("t:")) {
    const recipe = ENABLED_TEMPLATES.find((r) => `t:${r.id}` === key);
    const meal = recipe ? scaleTemplate(recipe, target) : null;
    if (recipe && meal) return { ...fromTemplateMeal(meal, recipe), coachStar: true };
  }
  if (key?.startsWith("r:") && coachRecipe && `r:${coachRecipe.id}` === key) {
    const meal = scaleLibraryRecipe(coachRecipe, coachRecipe.slot === "any" ? "lunch" : coachRecipe.slot, target);
    if (meal) return { ...meal, coachStar: true };
  }
  // The coach picked this meal for it: a whole portion nearest the target, whatever its kind of meal.
  return portionStarMeal(star, "lunch", target, { force: true });
}
