import type { NutrientMap } from "@/lib/food-serving";

// Adds up a day's food log into nutrient totals without ever turning "not reported" into zero. A logged entry carries a snapshot of the nutrients for the amount eaten (searched
// USDA foods, custom foods with a label, saved meals); an entry without one (a ticked-off plan meal, a quick log with only calories, a photo estimate) reports no micronutrients
// at all. So for each nutrient a day has:
//   * total: the sum over the entries that REPORT it, or null when none does (never 0);
//   * coveragePct: the share of the day's calories that came from entries that report it, so a low total from a mostly-unreported day is visibly "partly counted", not a low intake.
// Nothing here is ever sent to the AI.

export interface LoggedEntry {
  logDate: string;
  status: string | null;
  description: string | null;
  calories: number | null;
  nutrients: NutrientMap | null;
}

export interface DayNutrient {
  total: number | null;
  reportingEntries: number;
  entries: number;
  coveragePct: number;
}

export interface DayTotals {
  date: string;
  calories: number;
  entries: number;
  byKey: Record<string, DayNutrient>;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// An entry counts as food eaten when it was not skipped and has calories or a nutrient snapshot.
export const countsAsFood = (e: LoggedEntry): boolean => e.status !== "skipped" && (e.calories != null || e.nutrients != null);

export const reportsNutrient = (e: LoggedEntry, key: string): boolean => e.nutrients != null && isNum(e.nutrients[key]) && (e.nutrients[key] as number) >= 0;

export function dayTotals(date: string, entries: LoggedEntry[], keys: string[]): DayTotals {
  const food = entries.filter((e) => e.logDate === date && countsAsFood(e));
  const calories = food.reduce((s, e) => s + (isNum(e.calories) ? e.calories : 0), 0);
  const byKey: Record<string, DayNutrient> = {};
  for (const key of keys) {
    const reporting = food.filter((e) => reportsNutrient(e, key));
    const total = reporting.length === 0 ? null : reporting.reduce((s, e) => s + (e.nutrients![key] as number), 0);
    let coveragePct = 0;
    if (food.length > 0) {
      if (calories > 0) coveragePct = (reporting.reduce((s, e) => s + (isNum(e.calories) ? e.calories : 0), 0) / calories) * 100;
      else coveragePct = (reporting.length / food.length) * 100;
    }
    byKey[key] = { total, reportingEntries: reporting.length, entries: food.length, coveragePct: Math.round(coveragePct * 10) / 10 };
  }
  return { date, calories: Math.round(calories), entries: food.length, byKey };
}

// One DayTotals per date, in the order given (days with nothing logged are included, empty).
export const windowTotals = (dates: string[], entries: LoggedEntry[], keys: string[]): DayTotals[] => dates.map((d) => dayTotals(d, entries, keys));

// The share of a day's food entries that carry any nutrient detail at all: the overall "how complete is this day" figure.
export function detailShare(entries: LoggedEntry[], date: string): { detailed: number; total: number } {
  const food = entries.filter((e) => e.logDate === date && countsAsFood(e));
  return { detailed: food.filter((e) => e.nutrients != null && Object.keys(e.nutrients).some((k) => isNum(e.nutrients![k]) && !["kcal", "protein_g", "carbs_g", "fat_g"].includes(k))).length, total: food.length };
}

export interface SourceShare {
  name: string;
  amount: number;
  sharePct: number;
}

// The foods that gave the most of a nutrient over some entries, from the entries that report it. The share is of what was REPORTED, not of the whole intake.
export function topSources(entries: LoggedEntry[], key: string, limit = 5): SourceShare[] {
  const sums = new Map<string, { name: string; amount: number }>();
  let all = 0;
  for (const e of entries) {
    if (!countsAsFood(e) || !reportsNutrient(e, key)) continue;
    const amount = e.nutrients![key] as number;
    const name = (e.description ?? "Food").trim() || "Food";
    const k = name.toLowerCase();
    const cur = sums.get(k);
    if (cur) cur.amount += amount;
    else sums.set(k, { name, amount });
    all += amount;
  }
  return [...sums.values()]
    .filter((s) => s.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((s) => ({ name: s.name, amount: s.amount, sharePct: all > 0 ? Math.round((s.amount / all) * 100) : 0 }));
}
