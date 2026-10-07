import { addDaysToKey, weekdayOfKey } from "@/lib/date-key";

// The coach's read-only view of what a client logged over the last 7 days against their target. Pure: rows in, a week out. Days are plain date keys (the client's
// own calendar days, ending on the key passed as today), so no time zone can move a meal to the wrong day.

export interface FoodEntryRow {
  log_date: string;
  meal_slot: string | null;
  status: string; // 'ate_it' | 'modified' | 'skipped' | 'quick_log'
  description: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface DayTarget {
  calories: number | null;
  proteinG: number | null;
}

export interface FoodWeekMeal {
  slot: string | null;
  description: string | null;
  calories: number | null;
  skipped: boolean;
}

export interface FoodWeekDay {
  dateKey: string;
  weekday: string; // "Mon"
  isToday: boolean;
  logged: boolean; // at least one meal that was not skipped
  meals: FoodWeekMeal[];
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  target: DayTarget | null;
  // Calories eaten as a percent of the day's target, only for a logged day with a target.
  caloriesPct: number | null;
}

export interface FoodWeekSummary {
  days: FoodWeekDay[]; // oldest first, ending today
  loggedDays: number; // "logged anything on N of 7 days"
  avgCalories: number | null; // over logged days only
  avgProteinG: number | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function buildFoodWeek(args: {
  entries: FoodEntryRow[];
  todayKey: string;
  targetFor: (dateKey: string) => DayTarget | null;
  windowDays?: number;
}): FoodWeekSummary {
  const windowDays = args.windowDays ?? 7;
  const keys = Array.from({ length: windowDays }, (_, i) => addDaysToKey(args.todayKey, i - (windowDays - 1)));

  const days: FoodWeekDay[] = keys.map((dateKey) => {
    const rows = args.entries.filter((e) => e.log_date === dateKey);
    const eaten = rows.filter((r) => r.status !== "skipped");
    const calories = eaten.reduce((a, r) => a + n(r.calories), 0);
    const target = args.targetFor(dateKey);
    const logged = eaten.length > 0;
    return {
      dateKey,
      weekday: WEEKDAYS[weekdayOfKey(dateKey)] ?? "",
      isToday: dateKey === args.todayKey,
      logged,
      meals: rows.map((r) => ({ slot: r.meal_slot, description: r.description, calories: r.calories, skipped: r.status === "skipped" })),
      calories: Math.round(calories),
      proteinG: Math.round(eaten.reduce((a, r) => a + n(r.protein_g), 0)),
      carbsG: Math.round(eaten.reduce((a, r) => a + n(r.carbs_g), 0)),
      fatG: Math.round(eaten.reduce((a, r) => a + n(r.fat_g), 0)),
      target,
      caloriesPct: logged && target?.calories ? Math.round((calories / target.calories) * 100) : null,
    };
  });

  const logged = days.filter((d) => d.logged);
  return {
    days,
    loggedDays: logged.length,
    avgCalories: logged.length > 0 ? Math.round(logged.reduce((a, d) => a + d.calories, 0) / logged.length) : null,
    avgProteinG: logged.length > 0 ? Math.round(logged.reduce((a, d) => a + d.proteinG, 0) / logged.length) : null,
  };
}
