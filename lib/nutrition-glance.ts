import { buildOverview } from "@/lib/nutrient-view";
import type { LoggedEntry } from "@/lib/nutrient-day";
import type { Sex } from "@/lib/dri-data";
import type { FoodWeekSummary } from "@/lib/food-week";
import { weekdayOfKey, daysBetweenKeys } from "@/lib/date-key";

// The top of a coach's Nutrition page for one client (Ron, Oct 21: "revamp that whole page ... based on Cronometer", with his MacroFactor and Cronometer screenshots): the last 7 days as
// one grid (a column per day, four bars per day filled to that day's target), the week's daily average as a ring with a protein / carbs / fat table, and a tap on a day opens what they
// logged with the day's key vitamins and minerals as small bars. Pure: rows in, view out.

export type MacroRowKey = "calories" | "protein" | "carbs" | "fat";
export const GLANCE_ROWS: { key: MacroRowKey; label: string; unit: string }[] = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
];

export interface GlanceCell {
  eaten: number;
  target: number | null;
  /** Eaten as a percent of the day's target (a logged day with a target only); can pass 100. */
  pct: number | null;
}

export interface GlanceMeal {
  slot: string;
  items: { description: string; calories: number | null; skipped: boolean }[];
}

export interface GlanceDay {
  dateKey: string;
  letter: string; // "M"
  weekday: string; // "Mon"
  isToday: boolean;
  logged: boolean;
  cells: Record<MacroRowKey, GlanceCell>;
  meals: GlanceMeal[];
}

export interface WeekAverage {
  loggedDays: number;
  calories: number;
  /** grams and share of calories, over the logged days */
  macros: { key: Exclude<MacroRowKey, "calories">; grams: number; pctOfCalories: number }[];
}

export interface DayTargetFull {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const pct = (eaten: number, target: number | null, logged: boolean) => (logged && target && target > 0 ? Math.round((eaten / target) * 100) : null);
const SLOT_LABEL: Record<string, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks", snacks: "Snacks", pre_workout: "Pre-workout", post_workout: "Post-workout" };
const SLOT_ORDER = ["breakfast", "pre_workout", "lunch", "post_workout", "dinner", "snack", "snacks"];

export function slotLabel(slot: string | null): string {
  if (!slot) return "Other";
  return SLOT_LABEL[slot] ?? slot.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The 7 days of the food week as grid columns, each day against its own target (the order the client sees: the day's own target, else its meal plan, else the standing target). */
export function glanceDays(week: FoodWeekSummary, targetFor: (dateKey: string) => DayTargetFull | null): GlanceDay[] {
  return week.days.map((d) => {
    const t = targetFor(d.dateKey);
    const cell = (eaten: number, target: number | null | undefined): GlanceCell => ({ eaten, target: target ?? null, pct: pct(eaten, target ?? null, d.logged) });
    const bySlot = new Map<string, GlanceMeal["items"]>();
    for (const m of d.meals) {
      const key = m.slot ?? "";
      bySlot.set(key, [...(bySlot.get(key) ?? []), { description: m.description || slotLabel(m.slot), calories: m.calories, skipped: m.skipped }]);
    }
    const meals = [...bySlot.entries()]
      .sort(([a], [b]) => (SLOT_ORDER.indexOf(a) + 1 || 99) - (SLOT_ORDER.indexOf(b) + 1 || 99))
      .map(([slot, items]) => ({ slot: slotLabel(slot || null), items }));
    return {
      dateKey: d.dateKey,
      letter: LETTERS[weekdayOfKey(d.dateKey)] ?? "",
      weekday: d.weekday,
      isToday: d.isToday,
      logged: d.logged,
      cells: { calories: cell(d.calories, t?.calories), protein: cell(d.proteinG, t?.proteinG), carbs: cell(d.carbsG, t?.carbsG), fat: cell(d.fatG, t?.fatG) },
      meals,
    };
  });
}

/** The daily average over the days they logged anything (Cronometer's "Daily average"), or null with no logged day. */
export function weekAverage(days: GlanceDay[]): WeekAverage | null {
  const logged = days.filter((d) => d.logged);
  if (logged.length === 0) return null;
  const avg = (k: MacroRowKey) => logged.reduce((s, d) => s + d.cells[k].eaten, 0) / logged.length;
  const p = avg("protein");
  const c = avg("carbs");
  const f = avg("fat");
  const kcalFromMacros = p * 4 + c * 4 + f * 9;
  const share = (kcal: number) => (kcalFromMacros > 0 ? Math.round((kcal / kcalFromMacros) * 100) : 0);
  return {
    loggedDays: logged.length,
    calories: Math.round(avg("calories")),
    macros: [
      { key: "protein", grams: Math.round(p), pctOfCalories: share(p * 4) },
      { key: "carbs", grams: Math.round(c), pctOfCalories: share(c * 4) },
      { key: "fat", grams: Math.round(f), pctOfCalories: share(f * 9) },
    ],
  };
}

/** "2134 / 2143" when consumed, "9 left" (or "120 over") when remaining. */
export function cellText(cell: GlanceCell, mode: "consumed" | "remaining"): string {
  const n = (v: number) => Math.round(v).toLocaleString("en-US");
  if (mode === "consumed" || cell.target == null) return cell.target == null ? n(cell.eaten) : `${n(cell.eaten)} / ${n(cell.target)}`;
  const left = cell.target - cell.eaten;
  return left >= 0 ? `${n(left)} left` : `${n(-left)} over`;
}

// The weekly check-in suggestion runs on Mondays (vercel.json: the nutrition-checkin-suggestions job).
export const CHECKIN_WEEKDAY = 1;

/** "Check-in today", "Check-in tomorrow", "Check-in in 3 days" (counted in the coach's calendar days). */
export function checkinCountdown(todayKey: string): { days: number; label: string } {
  const days = (CHECKIN_WEEKDAY - weekdayOfKey(todayKey) + 7) % 7;
  return { days, label: days === 0 ? "Check-in today" : days === 1 ? "Check-in tomorrow" : `Check-in in ${days} days` };
}

export interface NutrientBar {
  key: string;
  label: string;
  /** null = not reported by any food logged that day */
  pct: number | null;
  worthALook: boolean;
}

/**
 * The day's key vitamins and minerals as a percent of this client's reference intake: the same figures as the vitamins-and-minerals list (lib/nutrient-view.ts), limited to the nutrients
 * the food data carries today that have a target. "Worth a look" is the same two-week verdict that list gives.
 */
export function dayNutrientBars(entries: LoggedEntry[], dayKey: string, age: number | null, sex: Sex | null): NutrientBar[] {
  const o = buildOverview({ entries: entries.filter((e) => e.logDate <= dayKey), todayKey: dayKey, age, sex });
  return o.rows
    .filter((r) => r.nutrient.role === "target" && r.nutrient.inDatabaseToday && r.ref?.target != null)
    .map((r) => ({ key: r.nutrient.key, label: r.nutrient.label, pct: r.total == null ? null : r.pct, worthALook: r.summary.status === "gap" }));
}

/** A weight trend for the mini card: the last 30 days of weigh-ins, oldest first, and the change over them. */
export function weightSeries(logs: { logged_date: string; weight: number }[], todayKey: string): { points: { date: string; weight: number }[]; change: number | null } {
  const points = logs
    .filter((l) => {
      const ago = daysBetweenKeys(l.logged_date, todayKey);
      return ago != null && ago >= 0 && ago <= 30;
    })
    .map((l) => ({ date: l.logged_date, weight: Number(l.weight) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { points, change: points.length >= 2 ? Math.round((points[points.length - 1].weight - points[0].weight) * 10) / 10 : null };
}
