// Standard coaching rules of thumb — a starting point the coach can
// always overwrite by hand afterward, not a locked formula.
export const PROTEIN_G_PER_LB = 1;

const CARB_SPLIT = {
  high: { carb: 0.7, fat: 0.3 },
  low: { carb: 0.3, fat: 0.7 },
} as const;

export function estimateProteinFromBodyWeight(bodyWeightLbs: number): number {
  return Math.round(bodyWeightLbs * PROTEIN_G_PER_LB);
}

// Splits whatever calories remain after protein into carbs/fat at a
// 70/30 (high carb) or 30/70 (low carb) ratio. Returns null when there's
// nothing sensible to split (no calories, no protein, or protein alone
// already meets or exceeds the calorie target).
export function fillCarbsAndFat(
  calories: number,
  proteinG: number,
  kind: "high" | "low"
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
