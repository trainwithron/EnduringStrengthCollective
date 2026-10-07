import type { NutritionPhase } from "@/lib/nutrition-checkin";

// Nutrition follows the client's CONFIRMED goal. A plain map from the goal's type to the phase the engine runs; a goal that carries its own phase (a coach-proposed
// "Rebuild: reverse diet", which is a custom goal) uses that instead.

export type GoalType = "weight_loss" | "body_recomp" | "muscle_gain" | "bodybuilding" | "powerbuilding_strongman" | "endurance_event" | "custom";

const GOAL_PHASE: Record<GoalType, NutritionPhase> = {
  weight_loss: "fat_loss",
  muscle_gain: "hypertrophy",
  bodybuilding: "hypertrophy",
  powerbuilding_strongman: "hypertrophy",
  body_recomp: "maintenance",
  endurance_event: "maintenance",
  custom: "maintenance",
};

const PHASES: NutritionPhase[] = ["fat_loss", "hypertrophy", "maintenance", "reverse_diet"];
const isPhase = (v: unknown): v is NutritionPhase => PHASES.includes(v as NutritionPhase);

export function goalToNutritionPhase(goalType: string | null | undefined, goalPhase?: string | null): NutritionPhase | null {
  if (isPhase(goalPhase)) return goalPhase;
  return goalType && goalType in GOAL_PHASE ? GOAL_PHASE[goalType as GoalType] : null;
}

export interface GoalRow {
  goal_type: string;
  status: string;
  nutrition_phase?: string | null;
  created_at?: string | null;
}

// The phase a client's goals point to. The newest CONFIRMED goal wins (confirmed: true). With none confirmed, the newest PROPOSED one still gives a phase so the
// calculator can compute, marked confirmed: false ("from their pick, not yet confirmed"). A declined goal is ignored.
export function phaseFromGoals(goals: GoalRow[]): { phase: NutritionPhase; confirmed: boolean; goalType: string } | null {
  const newestFirst = [...goals].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  for (const status of ["confirmed", "proposed"] as const) {
    const g = newestFirst.find((x) => x.status === status);
    if (g) {
      const phase = goalToNutritionPhase(g.goal_type, g.nutrition_phase);
      if (phase) return { phase, confirmed: status === "confirmed", goalType: g.goal_type };
    }
  }
  return null;
}

// The goal picker a client sees at onboarding (no custom, no endurance event: those need details a short form does not ask for).
export const ONBOARDING_GOALS: { type: GoalType; label: string; hint: string }[] = [
  { type: "weight_loss", label: "Lose weight", hint: "Lose fat while keeping muscle." },
  { type: "muscle_gain", label: "Build muscle", hint: "Gain size and strength." },
  { type: "body_recomp", label: "Get leaner and stronger at the same weight", hint: "Slowly change body shape; weight stays about the same." },
  { type: "bodybuilding", label: "Compete in bodybuilding", hint: "Physique work for the stage." },
  { type: "powerbuilding_strongman", label: "Powerlifting or strongman", hint: "Get strong at the big lifts." },
];
