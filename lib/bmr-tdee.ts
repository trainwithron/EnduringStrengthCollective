// Goal-date-aware nutrition — starting-point BMR/TDEE calculation
// (goal_date_aware_nutrition_and_programming_idea.md). Feeds the
// existing Smart Macro Fill work (daily-macros-form.tsx) as its
// starting calorie input, replacing a coach's manual guess with a real
// computed number. Two formulas only, both real, both current —
// Harris-Benedict is deliberately excluded per Ron's own direct call
// ("if it's outdated, I'm not gonna offer it"), not offered even as a
// manual option.
//
// Mifflin-St Jeor is the default for every client. Katch-McArdle
// (uses lean body mass instead of total weight, more accurate for
// leaner/more muscular people) activates automatically the moment a
// real body-fat % exists for that client — never a coach-facing formula
// picker, the switch itself is adaptive.

export type BiologicalSex = "male" | "female";

export function computeMifflinStJeorBmr(params: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: BiologicalSex;
}): number {
  const { weightKg, heightCm, age, sex } = params;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

export function computeKatchMcArdleBmr(params: { weightKg: number; bodyFatPct: number }): number {
  const leanMassKg = params.weightKg * (1 - params.bodyFatPct / 100);
  return 370 + 21.6 * leanMassKg;
}

// Katch-McArdle only once a real body-fat % is on file — otherwise
// Mifflin-St Jeor, the correct default for everyone else.
export function computeBmr(params: {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: BiologicalSex;
  bodyFatPct: number | null;
}): number {
  if (params.bodyFatPct != null) {
    return computeKatchMcArdleBmr({ weightKg: params.weightKg, bodyFatPct: params.bodyFatPct });
  }
  return computeMifflinStJeorBmr(params);
}

// Step-count-based activity categorization (Tudor-Locke's public-health
// step-count bands) — a measured number instead of a self-reported
// guess, since the app already collects daily steps for other reasons.
// Falls back to a plain self-reported category only when no real step
// data exists for this client.
export type ActivityCategory = "sedentary" | "light" | "moderate" | "active" | "very_active";

const ACTIVITY_MULTIPLIER: Record<ActivityCategory, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export function activityCategoryFromSteps(avgDailySteps: number): ActivityCategory {
  if (avgDailySteps < 5000) return "sedentary";
  if (avgDailySteps < 7500) return "light";
  if (avgDailySteps < 10000) return "moderate";
  if (avgDailySteps < 12500) return "active";
  return "very_active";
}

export function computeTdee(bmr: number, activity: ActivityCategory): number {
  return Math.round(bmr * ACTIVITY_MULTIPLIER[activity]);
}
