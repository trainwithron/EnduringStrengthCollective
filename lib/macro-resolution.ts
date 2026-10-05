import { resolveDayMacroTarget, type DayMacroTarget } from "./todays-macros";

// Which source a day's macro target came from, so the coach can see what an
// athlete is actually looking at.
export type MacroSource = "override" | "meal_plan" | "standing";

export interface MacroRowLike {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface ResolvedDayMacros {
  target: DayMacroTarget | null;
  source: MacroSource | null;
  // An explicit override is showing while a meal plan with different totals
  // also exists for the day. The plan's meals stay visible; the day is
  // labelled so nobody mistakes the meals' totals for the target.
  mealPlanDiffers: boolean;
}

function hasAnyValue(row: MacroRowLike | null | undefined): row is MacroRowLike {
  return (
    !!row &&
    (row.calories != null || row.protein_g != null || row.carbs_g != null || row.fat_g != null)
  );
}

function fromRow(row: MacroRowLike): DayMacroTarget {
  return { calories: row.calories, proteinG: row.protein_g, carbsG: row.carbs_g, fatG: row.fat_g };
}

// Resolution order for one day:
//   1. an explicit daily_macros row for that date (the coach's override)
//   2. a meal plan covering that day
//   3. the client's standing target
// An explicit day edit beats everything, including a meal plan whose totals
// were computed for a different number.
export function resolveDayMacros(
  dailyRow: MacroRowLike | null | undefined,
  mealPlanMacros: Parameters<typeof resolveDayMacroTarget>[1],
  mealPlanMeals: Parameters<typeof resolveDayMacroTarget>[2],
  standing: MacroRowLike | null | undefined
): ResolvedDayMacros {
  // Passing no daily row makes the shared resolver return the plan's own target.
  const planTarget = resolveDayMacroTarget(null, mealPlanMacros, mealPlanMeals);

  if (hasAnyValue(dailyRow)) {
    const target = fromRow(dailyRow);
    return {
      target,
      source: "override",
      mealPlanDiffers: !!planTarget && planTarget.calories != null && planTarget.calories !== target.calories,
    };
  }
  if (planTarget) return { target: planTarget, source: "meal_plan", mealPlanDiffers: false };
  if (hasAnyValue(standing)) return { target: fromRow(standing), source: "standing", mealPlanDiffers: false };
  return { target: null, source: null, mealPlanDiffers: false };
}

// The calorie figure shown on week/month cells: same order, calories only.
// `planCaloriesByDate` is optional for callers that only have override rows.
export function calorieTargetForDate(
  dateKey: string,
  overrideCaloriesByDate: Map<string, number | null>,
  standing: MacroRowLike | null | undefined,
  planCaloriesByDate?: Map<string, number | null>
): number | null {
  const override = overrideCaloriesByDate.get(dateKey);
  if (override != null) return override;
  const plan = planCaloriesByDate?.get(dateKey);
  if (plan != null) return plan;
  return standing?.calories ?? null;
}

export const SOURCE_LABEL: Record<MacroSource, string> = {
  override: "Set for this day",
  meal_plan: "From the day's meal plan",
  standing: "Standing target",
};

export interface StandingWithDate extends MacroRowLike {
  updated_at?: string | null;
}

function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A calorie-by-day series for trend analysis (is intake moving the way the
// client's phase says it should?). Explicit day rows are used as written. Days
// from the moment the standing target was last saved onward are filled with
// it, because from then on that IS the prescribed intake. Days before that are
// left empty rather than retroactively given a number nobody had set yet.
export function calorieSeriesWithStanding(
  overrideRows: { date: string; value: number }[],
  standing: StandingWithDate | null | undefined,
  startKey: string,
  endKey: string
): { date: string; value: number }[] {
  const byDate = new Map(overrideRows.map((r) => [r.date, r.value]));
  if (standing?.calories != null) {
    const effectiveFrom = standing.updated_at ? addDaysKey(standing.updated_at.slice(0, 10), -1) : startKey;
    let cursor = effectiveFrom > startKey ? effectiveFrom : startKey;
    while (cursor <= endKey) {
      if (!byDate.has(cursor)) byDate.set(cursor, standing.calories);
      cursor = addDaysKey(cursor, 1);
    }
  }
  return Array.from(byDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// The standing target applies from the day it was saved onward. Older dates
// get nothing from it, so changing the standing number today never rewrites
// what a past day showed.
export function standingForDate<T extends StandingWithDate>(
  standing: T | null | undefined,
  dateKey: string
): T | null {
  if (!standing) return null;
  // updated_at is UTC: a coach saving at 9pm US time is already "tomorrow" in UTC, so
  // allow one day of slack rather than hiding the target for the rest of their evening.
  const from = standing.updated_at ? addDaysKey(standing.updated_at.slice(0, 10), -1) : null;
  return from && dateKey < from ? null : standing;
}
