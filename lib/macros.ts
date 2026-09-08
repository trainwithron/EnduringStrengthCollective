// Standard coaching rules of thumb — a starting point the coach can
// always overwrite by hand afterward, not a locked formula.
export const PROTEIN_G_PER_LB = 1;

const CARB_SPLIT = {
  high: { carb: 0.7, fat: 0.3 },
  balanced: { carb: 0.5, fat: 0.5 },
  low: { carb: 0.3, fat: 0.7 },
} as const;

export function estimateProteinFromBodyWeight(bodyWeightLbs: number): number {
  return Math.round(bodyWeightLbs * PROTEIN_G_PER_LB);
}

// Splits whatever calories remain after protein into carbs/fat at a
// 70/30 (high carb), 50/50 (balanced), or 30/70 (low carb) ratio. Returns
// null when there's nothing sensible to split (no calories, no protein,
// or protein alone already meets or exceeds the calorie target).
export function fillCarbsAndFat(
  calories: number,
  proteinG: number,
  kind: "high" | "balanced" | "low"
): { carbsG: number; fatG: number } | null {
  if (!calories || !proteinG) return null;
  const remaining = calories - proteinG * 4;
  if (remaining <= 0) return null;
  const split = CARB_SPLIT[kind];
  return {
    carbsG: Math.round((remaining * split.carb) / 4),
    fatG: Math.round((remaining * split.fat) / 9),
  };
}

// A quick bodyweight-multiplier estimate of daily maintenance calories —
// the same rough kcal/lb heuristic coaches have used for decades, well
// before any app did the math. It's a starting point, not a diagnosis;
// see the guide alongside the calculator UI for how to find the real
// number.
export type ActivityLevel = "sedentary" | "light" | "moderate" | "very_active";

const ACTIVITY_KCAL_PER_LB: Record<ActivityLevel, number> = {
  sedentary: 12,
  light: 14,
  moderate: 16,
  very_active: 18,
};

export function estimateMaintenanceCalories(
  bodyWeightLbs: number,
  activity: ActivityLevel
): number {
  return Math.round(bodyWeightLbs * ACTIVITY_KCAL_PER_LB[activity]);
}

export type MacroGoal = "cut" | "maintain" | "lean_bulk";

const GOAL_ADJUSTMENT_PCT: Record<MacroGoal, number> = {
  cut: -0.2,
  maintain: 0,
  lean_bulk: 0.1,
};

export function applyGoalAdjustment(maintenanceCalories: number, goal: MacroGoal): number {
  return Math.round(maintenanceCalories * (1 + GOAL_ADJUSTMENT_PCT[goal]));
}
