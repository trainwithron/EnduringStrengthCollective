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

// A client's standing target is a HISTORY: each row says "from this date on, the target is X". Editing
// protein on Wednesday adds a Wednesday row; Monday and Tuesday keep what they showed. A row with no
// numbers means the standing target was removed from that date.
export interface StandingRow extends MacroRowLike {
  effective_from: string; // YYYY-MM-DD, the coach's own calendar day
}
export type StandingHistory = StandingRow[]; // ascending by effective_from

function addDaysKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The standing target in force on `dateKey`: the latest row on or before it. Null before the first row,
// or when that row is a removal.
export function standingForDate(history: StandingHistory | null | undefined, dateKey: string): StandingRow | null {
  if (!history || history.length === 0) return null;
  let found: StandingRow | null = null;
  for (const row of history) {
    if (row.effective_from <= dateKey) found = row;
    else break;
  }
  return found && hasAnyValue(found) ? found : null;
}

// The newest row, whatever date it takes effect (what the coach's card shows for editing).
export function latestStanding(history: StandingHistory | null | undefined): StandingRow | null {
  if (!history || history.length === 0) return null;
  const row = history[history.length - 1];
  return hasAnyValue(row) ? row : null;
}

// A calorie-by-day series for trend analysis (is intake moving the way the client's phase says it
// should?). Explicit day rows are used as written; other days take whatever the standing history said
// that day. Days before the first standing row stay empty.
export function calorieSeriesWithStanding(
  overrideRows: { date: string; value: number }[],
  history: StandingHistory | null | undefined,
  startKey: string,
  endKey: string
): { date: string; value: number }[] {
  const byDate = new Map(overrideRows.map((r) => [r.date, r.value]));
  if (history && history.length > 0) {
    const first = history[0].effective_from;
    let cursor = first > startKey ? first : startKey;
    while (cursor <= endKey) {
      if (!byDate.has(cursor)) {
        const row = standingForDate(history, cursor);
        if (row?.calories != null) byDate.set(cursor, row.calories);
      }
      cursor = addDaysKey(cursor, 1);
    }
  }
  return Array.from(byDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
