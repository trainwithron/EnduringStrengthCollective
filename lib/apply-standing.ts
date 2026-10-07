import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveDayMacros, standingForDate, type StandingHistory, type StandingRow } from "@/lib/macro-resolution";
import { addDaysToKey } from "@/lib/date-key";
import { shortDateLabel } from "@/lib/apply-from";
import { fetchStandingHistory, saveStandingTarget } from "@/lib/standing-macros";

// Applying a new STANDING target is not the same as the client seeing it. A day resolves in this order (lib/macro-resolution): the day's own target, else a meal
// plan assigned to that day, else the standing target. So after a coach applies a new standing target:
//   * any one-day target already set for those days, and any assigned meal plan built for a different number, still WINS; the coach must be told, with a way to fix it;
//   * a standing row scheduled for a LATER date would take over again on that date and silently undo the newer decision, so it is removed in the same step;
//   * the client is told "your target is now N" only if TODAY's number really changed.
// The planning is pure (this file's first half, tested without a database); the second half reads, saves and fixes.

export interface TargetValues {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface DayOverrideRow {
  log_date: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface DayPlanRow {
  log_date: string;
  macros: unknown;
  meals: unknown;
}

// How many days from the start date are checked for a day that will not follow the new target.
export const CONFLICT_WINDOW_DAYS = 14;

export interface DayConflict {
  date: string;
  // What the client will actually see that day instead of the new target.
  source: "override" | "meal_plan";
  calories: number | null;
  hasPlan: boolean;
}

// The standing history after the new target is applied from `startKey`: the row for that date replaces any row already on it, and any row scheduled LATER is dropped.
export function historyAfterApply(history: StandingHistory, startKey: string, target: TargetValues | null): StandingHistory {
  const kept = history.filter((r) => r.effective_from < startKey);
  const row: StandingRow = {
    effective_from: startKey,
    calories: target?.calories ?? null,
    protein_g: target?.proteinG ?? null,
    carbs_g: target?.carbsG ?? null,
    fat_g: target?.fatG ?? null,
  };
  return [...kept, row];
}

function resolveDay(date: string, history: StandingHistory, overrides: Map<string, DayOverrideRow>, plans: Map<string, DayPlanRow>) {
  const plan = plans.get(date);
  return resolveDayMacros(
    overrides.get(date) ?? null,
    (plan?.macros ?? null) as Parameters<typeof resolveDayMacros>[1],
    (plan?.meals ?? null) as Parameters<typeof resolveDayMacros>[2],
    standingForDate(history, date)
  );
}

export interface ApplyPlan {
  historyAfter: StandingHistory;
  // What today resolved to before and after, so the client is only told "your target is now N" when it really changed.
  todayBeforeCalories: number | null;
  todayAfterCalories: number | null;
  todayChanged: boolean;
  conflicts: DayConflict[];
  // Standing rows scheduled for a LATER date that this apply removed (so they cannot take over again): the coach is told which.
  removedScheduled: { date: string; calories: number | null }[];
}

export function planApply(args: {
  history: StandingHistory;
  startKey: string;
  todayKey: string;
  target: TargetValues | null;
  overrides: DayOverrideRow[];
  plans: DayPlanRow[];
}): ApplyPlan {
  const overrides = new Map(args.overrides.map((r) => [r.log_date, r]));
  const plans = new Map(args.plans.map((r) => [r.log_date, r]));
  const historyAfter = historyAfterApply(args.history, args.startKey, args.target);
  const before = resolveDay(args.todayKey, args.history, overrides, plans).target?.calories ?? null;
  const after = resolveDay(args.todayKey, historyAfter, overrides, plans).target?.calories ?? null;

  const conflicts: DayConflict[] = [];
  const want = args.target?.calories ?? null;
  if (want != null) {
    for (let i = 0; i < CONFLICT_WINDOW_DAYS; i++) {
      const date = addDaysToKey(args.startKey, i);
      const r = resolveDay(date, historyAfter, overrides, plans);
      if (r.source && r.source !== "standing" && (r.target?.calories ?? null) !== want) {
        const hasPlan = resolveDayMacros(null, (plans.get(date)?.macros ?? null) as Parameters<typeof resolveDayMacros>[1], (plans.get(date)?.meals ?? null) as Parameters<typeof resolveDayMacros>[2], null).source === "meal_plan";
        conflicts.push({ date, source: r.source, calories: r.target?.calories ?? null, hasPlan });
      }
    }
  }
  const removedScheduled = args.history.filter((r) => r.effective_from > args.startKey).map((r) => ({ date: r.effective_from, calories: r.calories }));
  return { historyAfter, todayBeforeCalories: before, todayAfterCalories: after, todayChanged: before !== after, conflicts, removedScheduled };
}

const num = (n: number | null) => (n == null ? "another number" : n.toLocaleString("en-US"));

function rangeLabel(first: string, last: string): string {
  if (first === last) return shortDateLabel(first);
  const a = shortDateLabel(first);
  const b = shortDateLabel(last);
  // "Oct 9 to 12" inside one month, "Oct 30 to Nov 2" across months.
  return a.split(" ")[0] === b.split(" ")[0] ? `${a} to ${b.split(" ")[1]}` : `${a} to ${b}`;
}

// Plain sentences for the coach: which days will NOT follow the new target, and why. Consecutive days with the same reason and number are one range.
export function describeConflicts(conflicts: DayConflict[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < conflicts.length) {
    let j = i;
    while (
      j + 1 < conflicts.length &&
      conflicts[j + 1].source === conflicts[i].source &&
      conflicts[j + 1].calories === conflicts[i].calories &&
      conflicts[j + 1].date === addDaysToKey(conflicts[j].date, 1)
    ) {
      j++;
    }
    const first = conflicts[i];
    const days = j - i + 1;
    const range = rangeLabel(first.date, conflicts[j].date);
    out.push(
      first.source === "override"
        ? `${range} ${days > 1 ? "have their own target" : "has its own target"} (${num(first.calories)}).`
        : `The meal plan assigned for ${range} is built for ${num(first.calories)}.`
    );
    i = j + 1;
  }
  return out;
}

// What the coach can do about those days from here. A one-day target is simply removed (the standing target, or the day's meal plan, then shows). A day's MEAL PLAN is
// not changed from here: writing the new target over a plan would leave the client looking at a number that does not match the meals built for the old one, so those days
// are listed for a new plan to be built. Removing a one-day target never notifies the client (only writing one does), so one click can never send a stack of notices.
export function conflictFixes(conflicts: DayConflict[]): { removeDates: string[]; planDates: string[] } {
  return {
    removeDates: conflicts.filter((c) => c.source === "override").map((c) => c.date),
    planDates: conflicts.filter((c) => c.hasPlan).map((c) => c.date),
  };
}

// "This also removed the target scheduled from Oct 14 (2,500)." for every scheduled row an apply or a save took away; empty when none.
export function describeRemovedScheduled(removed: { date: string; calories: number | null }[]): string[] {
  return removed.map((r) =>
    r.calories == null ? `This also removed the standing-target removal scheduled from ${shortDateLabel(r.date)}.` : `This also removed the target scheduled from ${shortDateLabel(r.date)} (${r.calories.toLocaleString("en-US")}).`
  );
}

// What the client is told. "Your daily target is now N" only when today's number really changed because of this; a future start says what changes and when; if today
// did not change (a one-day target or a meal plan still wins) the client is told only that the coach changed it, never a number that is not what they see.
export function pushMessageForApply(args: { newCalories: number | null; startKey: string; todayKey: string; todayChanged: boolean }): string {
  const { newCalories, startKey, todayKey, todayChanged } = args;
  if (startKey > todayKey) {
    return newCalories != null
      ? `Your daily target changes to ${newCalories.toLocaleString("en-US")} calories, from ${shortDateLabel(startKey)}`
      : `Your coach changed your calorie target, from ${shortDateLabel(startKey)}`;
  }
  if (todayChanged && newCalories != null) return `Your daily target is now ${newCalories.toLocaleString("en-US")} calories`;
  return `Your coach changed your calorie target, from ${shortDateLabel(startKey)}`;
}

// ---- reading, saving and fixing ----

export interface ApplyResult extends ApplyPlan {
  ok: true;
}

// Saves the target as the standing target from `startKey` (removing any later-dated rows, see saveStandingTarget) and reports what the client will really see.
export async function applyStandingTarget(
  supabase: SupabaseClient,
  args: { athleteId: string; groupId: string; userId: string | null; target: TargetValues | null; startKey: string; todayKey: string }
): Promise<ApplyResult | { ok: false }> {
  const { athleteId, groupId, userId, target, startKey, todayKey } = args;
  const end = addDaysToKey(startKey, CONFLICT_WINDOW_DAYS - 1);
  const history = await fetchStandingHistory(supabase, athleteId, groupId);
  // A read that fails reads as "nothing there": the target is still applied, the coach just is not warned about days we could not see.
  const [{ data: overrideRows }, { data: planRows }] = await Promise.all([
    supabase.from("daily_macros").select("log_date, calories, protein_g, carbs_g, fat_g").eq("athlete_id", athleteId).eq("group_id", groupId).gte("log_date", todayKey).lte("log_date", end),
    supabase.from("meal_plans").select("log_date, macros, meals").eq("athlete_id", athleteId).gte("log_date", todayKey).lte("log_date", end),
  ]);
  const saved = await saveStandingTarget(supabase, { athleteId, groupId, userId, target, today: startKey });
  if (!saved.ok) return { ok: false };
  const plan = planApply({
    history,
    startKey,
    todayKey,
    target,
    overrides: (overrideRows ?? []) as DayOverrideRow[],
    plans: (planRows ?? []) as DayPlanRow[],
  });
  return { ok: true, ...plan };
}

// The coach's one-click fix: removes the one-day targets that still beat the new target. (It deletes; it never writes a target, so it never notifies the client.)
export async function updateConflictingDays(
  supabase: SupabaseClient,
  args: { athleteId: string; groupId: string; conflicts: DayConflict[] }
): Promise<{ ok: boolean; removed: number }> {
  const { athleteId, groupId, conflicts } = args;
  const { removeDates } = conflictFixes(conflicts);
  if (removeDates.length === 0) return { ok: true, removed: 0 };
  const { error } = await supabase.from("daily_macros").delete().eq("athlete_id", athleteId).eq("group_id", groupId).in("log_date", removeDates);
  return error ? { ok: false, removed: 0 } : { ok: true, removed: removeDates.length };
}

// What to ask before a save that would delete scheduled targets ("Saving this also removes the target scheduled from Oct 14 (2,500). Continue?"). Empty when none.
export function scheduledConfirmMessage(scheduled: { date: string; calories: number | null }[]): string {
  if (scheduled.length === 0) return "";
  const parts = scheduled.map((r) => (r.calories == null ? `the removal scheduled from ${shortDateLabel(r.date)}` : `the target scheduled from ${shortDateLabel(r.date)} (${r.calories.toLocaleString("en-US")})`));
  return `Saving this also removes ${parts.join(" and ")}. Continue?`;
}

// One line saying what the apply did, in the coach's terms.
export function describeApplyOutcome(args: { plan: ApplyPlan; newCalories: number | null; startKey: string; todayKey: string }): string {
  const { plan, newCalories, startKey, todayKey } = args;
  const n = newCalories == null ? "the new target" : newCalories.toLocaleString("en-US");
  if (startKey > todayKey) return `Saved. From ${shortDateLabel(startKey)} the standing target is ${n}. Until then nothing changes.`;
  if (plan.todayChanged) return `Applied. Today's target is now ${n}.`;
  return `Saved as the standing target, but today still shows ${plan.todayAfterCalories == null ? "another number" : plan.todayAfterCalories.toLocaleString("en-US")} (see below).`;
}

// The weekly check-in record, written once however many times a half-failed Apply is retried: if the same check-in (same client, group, calories and reasoning) was
// recorded in the last day, it is not recorded again.
export async function insertCheckinOnce(
  supabase: SupabaseClient,
  row: { athlete_id: string; group_id: string; new_calories: number; rationale: string } & Record<string, unknown>,
  now: Date = new Date()
): Promise<{ ok: boolean }> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("nutrition_checkins")
    .select("id")
    .eq("athlete_id", row.athlete_id)
    .eq("group_id", row.group_id)
    .eq("new_calories", row.new_calories)
    .eq("rationale", row.rationale)
    .gte("created_at", since)
    .limit(1);
  if (existing && existing.length > 0) return { ok: true };
  const { error } = await supabase.from("nutrition_checkins").insert(row);
  return { ok: !error };
}
