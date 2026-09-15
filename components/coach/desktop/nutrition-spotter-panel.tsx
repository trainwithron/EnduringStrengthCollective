import type { StaleMealPlanResult } from "@/lib/nutrition-spotter";

// nutrition_spotter_scoping_sept15.md — check #2 (stale-plan-after-
// check-in), the real priority: page-level panel next to the meal
// planner, same relationship Programming Spotter has to the Program
// Builder. Deliberately a flag, never an auto-fix — the coach decides
// whether/how to regenerate, same "flag, don't act" discipline as every
// other Spotter in this app.
export function NutritionSpotterPanel({ result }: { result: StaleMealPlanResult }) {
  if (!result.isStale || result.planCalories === null) return null;

  // The sentence below describes the CHECK-IN's target relative to the
  // plan ("the check-in set X kcal — N kcal {direction} than the plan"),
  // so this must compare targetCalories against planCalories, not the
  // reverse — inverted originally, which made the panel tell a coach to
  // move the plan the wrong direction.
  const direction = result.targetCalories > result.planCalories ? "higher" : "lower";

  return (
    <div className="border border-rust/40 bg-rust/5 p-4">
      <p className="font-body text-xs text-rust uppercase tracking-wide font-medium">Nutrition Spotter</p>
      <p className="font-body text-sm text-chalk mt-1">
        Today&apos;s saved meal plan targets {result.planCalories} kcal, but the most recent check-in set{" "}
        {result.targetCalories} kcal — {result.diffKcal} kcal {direction} than the plan. Worth regenerating
        the plan to match, or confirming this gap is intentional.
      </p>
    </div>
  );
}
