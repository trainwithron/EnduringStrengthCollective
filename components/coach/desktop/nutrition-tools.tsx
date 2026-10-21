"use client";

import { MealPlanGenerator, type PlanTarget } from "@/components/coach/desktop/meal-plan-generator";
import type { FoodRules } from "@/lib/allergen-check";

interface SavedPlanShape {
  archetype: string;
  meal_count: number;
  include_snack: boolean;
  carb_cycling: boolean;
  rationale: string | null;
  macros: Record<string, unknown>;
  meals: Record<string, unknown>;
}

// The meal planner, built from the client's standing target (Ron, Oct 21: the calculator now lives in the standing target card, and the planner's own check-in step "is a direct repeat of
// weekly check-in ... that should be condensed down"). The weekly check-in has its own section; nothing here asks for weights or ratings again.
export function NutritionTools({
  athleteId,
  groupId,
  date,
  latestBodyWeight,
  existingPlan,
  target,
  defaultDietaryRestrictions,
  proteinGPerLb,
  foodRules,
  rulesReadable = true,
  allergiesAsked = true,
  clientName,
}: {
  athleteId: string;
  groupId: string;
  date: string;
  latestBodyWeight: number | null;
  existingPlan: SavedPlanShape | null;
  // The standing target in force today; the plan is built from it.
  target: PlanTarget | null;
  defaultDietaryRestrictions?: string | null;
  // This client's own protein target in g per pound (their preferences).
  proteinGPerLb?: number;
  // This client's food rules; the generator never offers an option that breaks them.
  foodRules?: FoodRules;
  // False when the client's saved food rules could not be read: the planner builds nothing then.
  rulesReadable?: boolean;
  allergiesAsked?: boolean;
  // Only so the client's name is kept out of meals saved to the coach's library.
  clientName?: string;
}) {
  return (
    <div className="space-y-4">
      <MealPlanGenerator
        athleteId={athleteId}
        groupId={groupId}
        date={date}
        latestBodyWeight={latestBodyWeight}
        existingPlan={existingPlan}
        target={target}
        defaultDietaryRestrictions={defaultDietaryRestrictions}
        proteinGPerLb={proteinGPerLb}
        foodRules={foodRules}
        rulesReadable={rulesReadable}
        allergiesAsked={allergiesAsked}
        clientName={clientName}
      />
    </div>
  );
}
