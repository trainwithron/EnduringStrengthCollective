import { addDaysToKey } from "@/lib/date-key";
import { KCAL_PER_LB } from "@/lib/metabolic-trend";
import { MIN_ADHERENT_DAYS } from "@/lib/food-log-adherence";

// "Find my real maintenance" (Ron, Oct 20: "a way to actually find your real macros. By trial and error"): the calories a client really burns, from their OWN weigh-ins and food log,
// the way the research says to (eat, log everything, weigh in, compare weekly averages: Funston, Heck). Pure: no database, no clock.
//   - The window is the last 21 days when every week of it qualifies, else the last 14.
//   - A week qualifies with at least MIN_WEIGH_INS weigh-ins and at least MIN_ADHERENT_DAYS (5) days of food logged.
//   - Weight change = the average of the last 7 days minus the average of the first 7 days; the weeks' middles are (window - 7) days apart.
//   - Maintenance = average intake over the logged days minus the change in pounds x 3,500 / days between, rounded to 50. A change of half a pound or less is flat: maintenance = intake.
//   - Guards: an answer more than 750 away from what they ate, or under their calorie floor, is not trusted ("keep logging another week").
// It only ever SUGGESTS: the client chooses to use it; nothing is applied by itself.

export const MIN_WEIGH_INS = 3;
export const FLAT_CHANGE_LB = 0.5;
export const MAX_GAP_FROM_INTAKE = 750;

export interface MaintenanceInput {
  weights: { date: string; weight: number }[]; // pounds
  eatenDays: { date: string; value: number }[]; // calories on each day something was logged (lib/nutrition-tracking.ts dailyCaloriesFromLog)
  todayKey: string;
  calorieFloor: number;
}

export type MaintenanceResult =
  | { ready: true; maintenance: number; avgIntake: number; weeklyChangeLb: number; flat: boolean; windowDays: 14 | 21 }
  | { ready: false; missing: string[] };

const roundTo50 = (n: number) => Math.round(n / 50) * 50;

function weekStats(input: MaintenanceInput, startKey: string) {
  const keys = new Set(Array.from({ length: 7 }, (_, i) => addDaysToKey(startKey, i)));
  const weights = input.weights.filter((w) => keys.has(w.date)).map((w) => w.weight);
  const eaten = input.eatenDays.filter((d) => keys.has(d.date));
  return { weighIns: weights.length, avgWeight: weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : null, loggedDays: eaten.length, calories: eaten.map((d) => d.value) };
}

function windowWeeks(input: MaintenanceInput, days: 14 | 21) {
  const start = addDaysToKey(input.todayKey, -(days - 1));
  return Array.from({ length: days / 7 }, (_, i) => weekStats(input, addDaysToKey(start, i * 7)));
}

const qualifies = (w: ReturnType<typeof weekStats>) => w.weighIns >= MIN_WEIGH_INS && w.loggedDays >= MIN_ADHERENT_DAYS;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function estimateRealMaintenance(input: MaintenanceInput): MaintenanceResult {
  const long = windowWeeks(input, 21);
  const short = windowWeeks(input, 14);
  const use: { weeks: ReturnType<typeof weekStats>[]; days: 14 | 21 } | null = long.every(qualifies) ? { weeks: long, days: 21 } : short.every(qualifies) ? { weeks: short, days: 14 } : null;

  if (!use) {
    // What is still missing, in plain words, for the two weeks that count (last week and this week).
    const [earlier, recent] = short;
    const missing: string[] = [];
    const weighIns = Math.max(0, MIN_WEIGH_INS - recent.weighIns) + Math.max(0, MIN_WEIGH_INS - earlier.weighIns);
    if (weighIns > 0) missing.push(`${plural(weighIns, "more weigh-in", "more weigh-ins")}`);
    if (recent.loggedDays < MIN_ADHERENT_DAYS) missing.push(`log food on ${plural(MIN_ADHERENT_DAYS - recent.loggedDays, "more day", "more days")} this week`);
    if (earlier.loggedDays < MIN_ADHERENT_DAYS) missing.push(`a full week of food logged before this one (${plural(earlier.loggedDays, "day", "days")} so far)`);
    return { ready: false, missing };
  }

  const first = use.weeks[0];
  const last = use.weeks[use.weeks.length - 1];
  const allCalories = use.weeks.flatMap((w) => w.calories);
  const avgIntake = allCalories.reduce((a, b) => a + b, 0) / allCalories.length;
  const change = (last.avgWeight as number) - (first.avgWeight as number);
  const daysBetween = use.days - 7;
  const flat = Math.abs(change) <= FLAT_CHANGE_LB;
  const raw = flat ? avgIntake : avgIntake - (change * KCAL_PER_LB) / daysBetween;
  const maintenance = roundTo50(raw);
  if (Math.abs(raw - avgIntake) > MAX_GAP_FROM_INTAKE || maintenance < input.calorieFloor) {
    return { ready: false, missing: ["keep logging another week (the numbers so far do not add up yet)"] };
  }
  return { ready: true, maintenance, avgIntake: roundTo50(avgIntake), weeklyChangeLb: Math.round(((change * 7) / daysBetween) * 10) / 10, flat, windowDays: use.days };
}

// "You ate about 2,450 a day and lost 0.6 lb a week, so you burn about 2,750."
export function maintenanceSentence(r: Extract<MaintenanceResult, { ready: true }>): string {
  const n = (x: number) => x.toLocaleString("en-US");
  const change = Math.abs(r.weeklyChangeLb);
  const what = r.flat ? "your weight held steady" : r.weeklyChangeLb < 0 ? `lost ${change} lb a week` : `gained ${change} lb a week`;
  return `You ate about ${n(r.avgIntake)} a day and ${what}, so you burn about ${n(r.maintenance)}.`;
}
