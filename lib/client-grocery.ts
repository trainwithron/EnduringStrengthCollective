import { filterPlanForClient } from "@/lib/plan-preference-check";
import type { FoodRules } from "@/lib/allergen-check";
import type { PlanDay } from "@/lib/grocery-list";
import type { MealEntryPayload } from "@/lib/meal-plan-assignment";

// The days of a client's saved plan, as their grocery list counts them. Each day goes through the SAME filter the plan screen uses for the client (filterPlanForClient): an option that breaks their allergies, intolerances,
// dislikes or diet is removed before anything is added up, so the list never asks them to buy it. If their rules could not be read ("unreadable") the answer is null: nothing is listed, never an unchecked list.
export type ClientGroceryRules = FoodRules | "unreadable";

export function clientGroceryDays(rows: { log_date: string; carb_cycling: boolean | null; meals: unknown }[], rules: ClientGroceryRules): PlanDay[] | null {
  if (rules === "unreadable") return null;
  const days: PlanDay[] = [];
  for (const r of rows) {
    if (!r.meals || typeof r.meals !== "object" || Array.isArray(r.meals)) continue;
    const view = filterPlanForClient(r.meals as Record<string, MealEntryPayload[]>, rules);
    if (!view.meals) continue;
    days.push({ date: r.log_date, carbCycling: !!r.carb_cycling, meals: view.meals });
  }
  return days;
}
