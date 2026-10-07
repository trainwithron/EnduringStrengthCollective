import { computeKatchMcArdleBmr, computeMifflinStJeorBmr, computeTdee } from "@/lib/bmr-tdee";
import { calorieFloor, isBelowFloor, belowFloorMessage } from "@/lib/calorie-floor";
import { ageOnDate } from "@/lib/nutrition-profile";
import { applyGoalAdjustment, computeArchetypeMacros, fillCarbsAndFat, PROTEIN_G_PER_LB, type DietArchetype } from "@/lib/macros";
import type { NutritionPhase } from "@/lib/nutrition-checkin";
import { PHASE_LABELS, type PhasePlan } from "@/lib/phase-plan";
import { phaseFromGoals, type GoalRow } from "@/lib/goal-to-nutrition-phase";
import { ACTIVITY_LEVELS, type ActivityKey } from "@/lib/client-body-profile";
import { KG_PER_LB } from "@/lib/units";

// A STARTING target for a brand-new client: maintenance from their real height, weight, age and activity, moved by the phase their confirmed goal points to, with
// protein from their own rule and carbs and fat from their split. It is only ever a suggestion the coach reviews; nothing here writes anything.

export interface BaselineInput {
  weightLbs: number | null;
  heightCm: number | null;
  // null = "prefer not to say": the average of the two formulas is used, and the card says so.
  sex: "male" | "female" | null;
  dateOfBirth: string | null;
  bodyFatPct: number | null;
  activity: ActivityKey | null;
  phase: NutritionPhase;
  todayKey: string;
  proteinGPerLb?: number;
  carbSplit?: "high" | "balanced" | "low";
  dietType?: string | null;
}

export interface BaselineResult {
  ok: true;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  // The phase the number was worked out for (a deficit for a client under 18 becomes maintenance).
  phase: NutritionPhase;
  maintenance: number;
  bmr: number;
  floor: number;
  belowFloor: boolean;
  ageYears: number;
  formula: string;
  // Held at maintenance because the client is under 18 (never a deficit).
  heldForAge: boolean;
  rationale: string;
}

export type BaselineOutcome = BaselineResult | { ok: false; missing: string[] };

function archetypeOf(dietType: string | null | undefined): DietArchetype {
  return dietType === "keto" ? "keto" : dietType === "carnivore" ? "carnivore" : "standard";
}

export function computeBaseline(input: BaselineInput): BaselineOutcome {
  const missing: string[] = [];
  if (input.heightCm == null) missing.push("height");
  if (input.weightLbs == null) missing.push("a weight");
  if (!input.dateOfBirth) missing.push("date of birth");
  if (!input.activity || !ACTIVITY_LEVELS.includes(input.activity)) missing.push("activity level");
  const age = input.dateOfBirth ? ageOnDate(input.dateOfBirth, input.todayKey) : null;
  if (input.dateOfBirth && (age == null || age < 0 || age > 120)) missing.push("a valid date of birth");
  if (missing.length > 0 || input.weightLbs == null || input.heightCm == null || age == null || !input.activity) return { ok: false, missing };

  const weightKg = input.weightLbs * KG_PER_LB;
  let bmr: number;
  let formula: string;
  if (input.bodyFatPct != null) {
    bmr = computeKatchMcArdleBmr({ weightKg, bodyFatPct: input.bodyFatPct });
    formula = "Katch-McArdle (uses their body fat)";
  } else if (input.sex) {
    bmr = computeMifflinStJeorBmr({ weightKg, heightCm: input.heightCm, age, sex: input.sex });
    formula = "Mifflin-St Jeor";
  } else {
    bmr = (computeMifflinStJeorBmr({ weightKg, heightCm: input.heightCm, age, sex: "male" }) + computeMifflinStJeorBmr({ weightKg, heightCm: input.heightCm, age, sex: "female" })) / 2;
    formula = "Mifflin-St Jeor, the average of the male and female formulas (sex not given)";
  }
  bmr = Math.round(bmr);
  const maintenance = computeTdee(bmr, input.activity);

  // Never a calorie deficit for a client under 18: they are held at maintenance and the card says why.
  const heldForAge = age < 18 && input.phase === "fat_loss";
  const phase: NutritionPhase = heldForAge ? "maintenance" : input.phase;
  const calories = applyGoalAdjustment(maintenance, phase);

  const archetype = archetypeOf(input.dietType);
  const gPerLb = input.proteinGPerLb ?? PROTEIN_G_PER_LB;
  let macros = computeArchetypeMacros(calories, input.weightLbs, archetype, gPerLb);
  if (archetype === "standard" && input.carbSplit && input.carbSplit !== "balanced") {
    const split = fillCarbsAndFat(calories, macros.proteinG, input.carbSplit);
    if (split) macros = { ...macros, carbsG: split.carbsG, fatG: split.fatG };
  }

  const floor = calorieFloor({ sex: input.sex, bmr });
  const belowFloor = isBelowFloor(calories, floor);
  const parts = [
    `Starting target from their own numbers: ${formula}, a base of ${bmr.toLocaleString("en-US")} a day, ${input.activity.replace("_", " ")} activity, so about ${maintenance.toLocaleString("en-US")} to hold their weight.`,
    heldForAge
      ? `Their goal points to fat loss, but they are under 18, so this holds them at maintenance. No deficit is suggested for anyone under 18.`
      : `Phase: ${PHASE_LABELS[phase].toLowerCase()}${phase === "maintenance" ? "" : `, ${calories > maintenance ? "plus" : "minus"} ${Math.abs(Math.round((calories / maintenance - 1) * 100))} percent`}, which is ${calories.toLocaleString("en-US")} calories.`,
    `Protein ${macros.proteinG} g (${gPerLb} g per pound).`,
    `Review it and change anything you like: nothing applies until you approve it.`,
  ];
  if (belowFloor) parts.push(belowFloorMessage(calories, floor, "this client"));
  return { ok: true, calories, proteinG: macros.proteinG, carbsG: macros.carbsG, fatG: macros.fatG, phase, maintenance, bmr, floor, belowFloor, ageYears: age, formula, heldForAge, rationale: parts.join(" ") };
}

// The phase a starting target is worked out for: the coach's saved phase, else the goal the client and coach agreed (or the client proposed, not yet confirmed),
// else maintenance (with a note saying nothing was set). Used by the coach screen and the weekly job so they always agree.
export function chooseBaselinePhase(plan: PhasePlan | null, goals: GoalRow[]): { phase: NutritionPhase; note: string } {
  if (plan) return { phase: plan.phase, note: "their phase" };
  const fromGoal = phaseFromGoals(goals);
  if (fromGoal) return { phase: fromGoal.phase, note: fromGoal.confirmed ? "their confirmed goal" : "their goal pick, not yet confirmed" };
  return { phase: "maintenance", note: "no phase or goal yet, so maintenance" };
}
