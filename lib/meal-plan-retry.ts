// A client who is not feeling their meal plan can ask for a different one ("Not feeling it? Tell us what to change."), up to 3 times per plan the coach assigned. This file is
// everything about it that needs no database or screen:
//   * how many tries are used and how many are left. The count is READ from the plan itself: every day a try rebuilds says "Rebuilt at the client's request (try N of 3)." so a coach who
//     assigns a new plan, or builds a day by hand, changes what the plan says and the count follows. (The database function enforces the same count; this is for the screens.)
//   * which days a try may rebuild: days the recipe library built (or an earlier try rebuilt), today and later. A day the coach built by hand is never touched, and a day that has
//     passed never changes.
//   * what the client typed, read with the SAME deterministic reader the coach's restrictions note uses. The text is never sent to an AI. What it names becomes food the client
//     avoids or likes, saved on their preferences, and shapes the rebuild.
//   * the rebuild itself, from the library (no AI): the same plan shape the coach's "Build the week" writes, from the macros and meal counts already on each day.
import { type FoodRules } from "@/lib/allergen-check";
import { choiceKey, mealRecipeChoices, type MealEntryPayload } from "@/lib/meal-plan-assignment";
import { entriesFromMeals, generateLibraryWeek } from "@/lib/library-meal-plan";
import type { SelectionContext } from "@/lib/library-selection";
import type { MacroTargets } from "@/lib/meal-engine";
import { addItem, type NutritionPreferences } from "@/lib/nutrition-preferences";
import { describeTypedRules, mergeRules, rulesFromTypedText, type TypedRules } from "@/lib/typed-restrictions";
import { clientTryNumber, isLibraryRationale } from "@/lib/week-replace";

export const MAX_PLAN_TRIES = 3;
export const MAX_RETRY_NOTE = 300;

export interface PlanRowLite {
  log_date: string;
  rationale: string | null;
}

// Tries used on the plan that is standing now: the highest try number written on a day from today on.
export function triesUsed(rows: PlanRowLite[], todayKey: string): number {
  let used = 0;
  for (const r of rows) {
    if (r.log_date < todayKey) continue;
    const n = clientTryNumber(r.rationale);
    if (n !== null && n > used) used = n;
  }
  return Math.min(used, MAX_PLAN_TRIES);
}

export const triesLeft = (used: number): number => Math.max(0, MAX_PLAN_TRIES - used);

export interface RetryDays {
  // Days a try would rebuild, in date order.
  rebuild: string[];
  // Days from today on that the coach built by hand (left exactly as they are).
  skippedHand: string[];
}

export function retryDays(rows: PlanRowLite[], todayKey: string): RetryDays {
  const out: RetryDays = { rebuild: [], skippedHand: [] };
  for (const r of [...rows].sort((a, b) => a.log_date.localeCompare(b.log_date))) {
    if (r.log_date < todayKey) continue;
    (isLibraryRationale(r.rationale) ? out.rebuild : out.skippedHand).push(r.log_date);
  }
  return out;
}

// What the box on the client's meal plan screen should do.
export type RetryState =
  | { kind: "ready"; triesLeft: number }
  | { kind: "none_left" }
  // Every day from today on was planned by hand: a rebuild would change nothing, so the box points at the coach.
  | { kind: "hand_built" }
  // No plan from today on: nothing to rebuild, no box.
  | { kind: "no_plan" };

export function retryState(rows: PlanRowLite[], todayKey: string): RetryState {
  const days = retryDays(rows, todayKey);
  if (days.rebuild.length === 0 && days.skippedHand.length === 0) return { kind: "no_plan" };
  if (days.rebuild.length === 0) return { kind: "hand_built" };
  const used = triesUsed(rows, todayKey);
  return used >= MAX_PLAN_TRIES ? { kind: "none_left" } : { kind: "ready", triesLeft: triesLeft(used) };
}

export const NOTHING_UNDERSTOOD =
  "I couldn't tell what to change. Try something like: no fish, more chicken, vegetarian. Or message your coach.";

export type ReadNote =
  | { ok: true; typed: TypedRules; likes: string[]; dislikes: string[]; summary: string; text: string }
  | { ok: false; message: string };

// What the client typed, as food rules. An allergen group named here ("no dairy") hard-drops those foods from THIS rebuild (the safe side), but is saved as something the client avoids,
// never as an allergy: allergies are safety records the client and coach set on purpose, not a remark in a text box.
export function readRetryNote(raw: string | null | undefined): ReadNote {
  const text = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_RETRY_NOTE);
  if (!text) return { ok: false, message: NOTHING_UNDERSTOOD };
  const typed = rulesFromTypedText(text);
  const dislikes = [...new Set([...typed.allergies, ...typed.dislikes])];
  const understood = dislikes.length > 0 || typed.likes.length > 0 || !!typed.dietType;
  if (!understood) return { ok: false, message: NOTHING_UNDERSTOOD };
  return { ok: true, typed, likes: typed.likes, dislikes, summary: describeTypedRules(typed).slice(0, 300), text };
}

// The client's saved tastes plus what this note named. Lists have a size limit; one that is full simply skips the extra (the rebuild still honors it).
export function mergeTastes(prefs: NutritionPreferences, read: Extract<ReadNote, { ok: true }>): NutritionPreferences {
  let dislikes = prefs.dislikes;
  let likes = prefs.likes;
  for (const d of read.dislikes) dislikes = addItem(dislikes, d).list;
  for (const l of read.likes) likes = addItem(likes, l).list;
  return { ...prefs, dislikes, likes };
}

// The rules a rebuild applies: the client's saved rules (after the note's foods were saved) plus the note itself, so a typed allergen group is a hard drop and a typed diet counts for
// this build even though the client cannot change their saved diet type.
export function rulesForRetry(saved: FoodRules, read: Extract<ReadNote, { ok: true }>): FoodRules {
  return mergeRules(saved, read.typed);
}

export interface ExistingPlanRow {
  log_date: string;
  archetype: string;
  meal_count: number;
  include_snack: boolean;
  carb_cycling: boolean;
  rationale: string | null;
  macros: Record<string, MacroTargets>;
  meals: Record<string, MealEntryPayload[]> | null;
  created_by: string;
}

export interface RebuiltRow {
  log_date: string;
  archetype: string;
  meal_count: number;
  include_snack: boolean;
  carb_cycling: boolean;
  macros: Record<string, MacroTargets>;
  meals: Record<string, ReturnType<typeof entriesFromMeals>>;
  created_by: string;
}

export interface RebuildResult {
  rows: RebuiltRow[];
  // True when some meal ended with NO option at all (the client's rules left nothing for it): the rebuild must not be saved.
  hasEmptyMeal: boolean;
}

const BUCKETS = ["daily", "train", "rest"] as const;

// The same plan shape the coach's "Build the week" saves, for the days a try may rebuild, from each day's own macros, meal count and snack setting (days that share them are built
// together so the week keeps its variety). Library only.
export function rebuildRows(args: { plan: ExistingPlanRow[]; days: string[]; ctxFor: (archetype: string) => SelectionContext; rotateFeatured: boolean }): RebuildResult {
  const byDate = new Map(args.plan.map((r) => [r.log_date, r]));
  const groups = new Map<string, string[]>();
  for (const d of [...args.days].sort()) {
    const r = byDate.get(d);
    if (!r) continue;
    const key = `${r.archetype}|${r.meal_count}|${r.include_snack}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const rows: RebuiltRow[] = [];
  let hasEmptyMeal = false;
  for (const dates of groups.values()) {
    const first = byDate.get(dates[0])!;
    const ctx = args.ctxFor(first.archetype);
    const weeks: Partial<Record<(typeof BUCKETS)[number], ReturnType<typeof generateLibraryWeek>>> = {};
    for (const b of BUCKETS) {
      if (!dates.some((d) => byDate.get(d)!.macros?.[b])) continue;
      weeks[b] = generateLibraryWeek({
        dates: dates.filter((d) => byDate.get(d)!.macros?.[b]),
        dayMacros: (d) => byDate.get(d)!.macros[b],
        mealCount: first.meal_count,
        includeSnack: first.include_snack,
        ctx,
        rotateFeatured: args.rotateFeatured,
      });
    }
    for (const d of dates) {
      const r = byDate.get(d)!;
      const meals: RebuiltRow["meals"] = {};
      for (const b of BUCKETS) {
        const built = weeks[b]?.[d];
        if (!built) continue;
        if (built.some((m) => m.options.length === 0)) hasEmptyMeal = true;
        meals[b] = entriesFromMeals(built);
      }
      rows.push({ log_date: d, archetype: r.archetype, meal_count: r.meal_count, include_snack: r.include_snack, carb_cycling: r.carb_cycling, macros: r.macros, meals, created_by: r.created_by });
    }
  }
  return { rows: rows.sort((a, b) => a.log_date.localeCompare(b.log_date)), hasEmptyMeal };
}

function optionKeys(meals: Record<string, MealEntryPayload[]> | null | undefined): string {
  const keys: string[] = [];
  for (const entries of Object.values(meals ?? {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      for (const choice of mealRecipeChoices(entry)) {
        const k = choiceKey(choice);
        if (k) keys.push(k);
      }
    }
  }
  return keys.sort().join("|");
}

// True when at least one rebuilt day offers different meals than it did. A "different plan" that is the same plan must not spend a try.
export function planChanged(before: ExistingPlanRow[], after: RebuiltRow[]): boolean {
  const old = new Map(before.map((r) => [r.log_date, optionKeys(r.meals)]));
  return after.some((r) => old.get(r.log_date) !== optionKeys(r.meals as unknown as Record<string, MealEntryPayload[]>));
}
