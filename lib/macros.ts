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

// Ported from enduring_strength_fixed_1.html's runCheckInEngine() macro
// split — protein locks to 1g/lb bodyweight regardless of archetype;
// only carbs/fat branch. Kept in this file (not a second macro-math
// module) per the nutrition check-in engine's own scoping note: this
// extends the existing Smart Macro Fill math rather than duplicating it.
export type DietArchetype = "keto" | "carnivore" | "standard";

// The source tool's detectArchetype() also recognizes vegan/vegetarian/
// paleo, but those only ever affect food *suggestions* elsewhere in that
// tool — its own macro-split math treats every archetype other than
// keto/carnivore identically (the "standard" branch below), so this
// port only distinguishes the three buckets that actually change the
// calorie math.
export function detectDietArchetype(dietaryRestrictionsText: string | null | undefined): DietArchetype {
  const t = (dietaryRestrictionsText ?? "").toLowerCase();
  if (t.includes("carnivore") || t.includes("zero carb")) return "carnivore";
  if (t.includes("keto")) return "keto";
  return "standard";
}

export interface ArchetypeMacroSplit {
  proteinG: number;
  carbsG: number;
  fatG: number;
  // The real total after rounding each macro to a whole gram — can
  // differ slightly from the input `calories` target, same as the
  // source tool's own resolvedBaseCals.
  resolvedCalories: number;
}

export function computeArchetypeMacros(
  calories: number,
  bodyWeightLbs: number,
  archetype: DietArchetype
): ArchetypeMacroSplit {
  const proteinG = estimateProteinFromBodyWeight(bodyWeightLbs);
  let carbsG: number;
  let fatG: number;

  if (archetype === "carnivore") {
    carbsG = 0;
    fatG = Math.round((calories - proteinG * 4) / 9);
  } else if (archetype === "keto") {
    carbsG = 25;
    fatG = Math.round((calories - proteinG * 4 - 25 * 4) / 9);
  } else {
    fatG = Math.max(45, Math.round((calories * 0.25) / 9));
    carbsG = Math.max(50, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  }

  const resolvedCalories = proteinG * 4 + carbsG * 4 + fatG * 9;
  return { proteinG, carbsG, fatG, resolvedCalories };
}
