// "Goals, all in one" (Ron, Nov 23: "I should be able to send a client the full goals, and it will be linked with the goal sheet, like all in one"). One Goals card on the coach's
// view of a client (main goal, smaller goals, goal sheet; one status), one send (one notice), and one page where the client fills in all of it with one button. The pure parts
// are here; the card is components/coach/goals-card.tsx, the page's form components/shared/goals-form.tsx, the save app/api/goals/route.ts, the send
// app/api/goal-sheet/send/route.ts.
import { GOAL_TYPE_LABELS, GOAL_TYPE_ORDER, goalTypeHasEventFields } from "@/lib/goal-types";
import type { GoalType } from "@/lib/goal-reversal";
import { goalSheetHasAnswers, goalSheetWaitingOnClient, type GoalSheetAnswers, type GoalSheetRow } from "@/lib/goal-sheet";
import { ADHERENCE_WINDOW_DAYS, computeAdherenceDays, loggedDateKeys } from "@/lib/food-log-adherence";

export type GoalsCardState = "new" | "sent" | "done";

// The goal sheet carries the card's status: sent and not saved since = waiting; saved with answers = filled in; otherwise not started.
export function goalsCardState(sheet: Pick<GoalSheetRow, "requested_at" | "filled_at"> & Partial<GoalSheetAnswers> | null | undefined): GoalsCardState {
  if (goalSheetWaitingOnClient(sheet)) return "sent";
  if (sheet?.filled_at && goalSheetHasAnswers(sheet as GoalSheetAnswers)) return "done";
  return "new";
}

export function shortDay(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) });
}

// "Not started" / "Sent Nov 23 · waiting on Robyn" / "Filled in Nov 24".
export function goalsCardPill(state: GoalsCardState, sheet: Pick<GoalSheetRow, "requested_at" | "filled_at"> | null | undefined, firstName: string, timeZone?: string): string {
  if (state === "sent" && sheet?.requested_at) return `Sent ${shortDay(sheet.requested_at, timeZone)} · waiting on ${firstName}`;
  if (state === "done" && sheet?.filled_at) return `Filled in ${shortDay(sheet.filled_at, timeZone)}`;
  return "Not started";
}

export interface MainGoalRow {
  goal_type: string;
  custom_label: string | null;
  target_date: string | null;
  status: string;
  created_by: string | null;
}

export function goalLabel(goalType: string, customLabel: string | null | undefined): string {
  return goalType === "custom" && customLabel?.trim() ? customLabel.trim() : GOAL_TYPE_LABELS[goalType as GoalType] ?? goalType;
}

// "Mar 1" for a date the goal is due ("2027-03-01"), read as a calendar day (never moved by a time zone).
export function goalDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: y !== new Date().getUTCFullYear() ? "numeric" : undefined, timeZone: "UTC" });
}

// The Main goal row: the goal and its date, with who it is waiting on while it is being agreed. Null when there is none (or the last one was not agreed).
export function mainGoalLine(goal: MainGoalRow | null | undefined, athleteId: string, firstName: string): { text: string; note: string | null } | null {
  if (!goal || goal.status === "declined") return null;
  const text = `${goalLabel(goal.goal_type, goal.custom_label)}${goal.target_date ? `, by ${goalDay(goal.target_date)}` : ""}`;
  if (goal.status === "proposed") return { text, note: goal.created_by === athleteId ? `${firstName} suggested; waiting on you` : `you suggested; ${firstName} confirms` };
  return { text, note: null };
}

// Ron's 7 questions, as the sheet stores them: the 1-10 and "why that number" are one question, the three days of eating are one.
export function goalSheetAnsweredCount(a: Partial<GoalSheetAnswers> | null | undefined): number {
  if (!a) return 0;
  const has = (v: unknown) => v != null && v !== "";
  return [
    has(a.why_matters),
    has(a.success_90_days),
    has(a.obstacles),
    has(a.days_per_week),
    has(a.want_score) || has(a.want_why),
    has(a.work_willing),
    has(a.food_day_1) || has(a.food_day_2) || has(a.food_day_3),
  ].filter(Boolean).length;
}

// "All 7 answered · wants it 9/10 · 3 days a week"
export function goalSheetSummary(a: Partial<GoalSheetAnswers> | null | undefined): string {
  const n = goalSheetAnsweredCount(a);
  const parts = [n === 7 ? "All 7 answered" : `${n} of 7 answered`];
  if (a?.want_score != null) parts.push(`wants it ${a.want_score}/10`);
  if (a?.days_per_week != null) parts.push(`${a.days_per_week} ${a.days_per_week === 1 ? "day" : "days"} a week`);
  return parts.join(" · ");
}

// ---- the main goal a save or a send writes ----

export interface MainGoalInput {
  goalType: GoalType;
  customLabel: string | null;
  targetDate: string | null;
  eventType: string | null;
  eventPriority: "A" | "B" | "C" | null;
  weightClassFlag: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// What a main goal from the page may be: a known type, a custom goal only with words, a real date or none, the event fields only for the two event types. Null when no goal was
// chosen or it is not a valid one.
export function cleanMainGoal(raw: unknown): MainGoalInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const goalType = r.goalType as GoalType;
  if (!GOAL_TYPE_ORDER.includes(goalType)) return null;
  const customLabel = goalType === "custom" && typeof r.customLabel === "string" ? r.customLabel.trim().slice(0, 200) : "";
  if (goalType === "custom" && !customLabel) return null;
  const date = typeof r.targetDate === "string" && DAY.test(r.targetDate) && !Number.isNaN(Date.parse(`${r.targetDate}T00:00:00Z`)) ? r.targetDate : null;
  const event = goalTypeHasEventFields(goalType);
  const eventType = event && typeof r.eventType === "string" ? r.eventType.trim().slice(0, 120) || null : null;
  const eventPriority = event && (r.eventPriority === "A" || r.eventPriority === "B" || r.eventPriority === "C") ? r.eventPriority : null;
  return { goalType, customLabel: customLabel || null, targetDate: date, eventType, eventPriority, weightClassFlag: goalType === "powerbuilding_strongman" && r.weightClassFlag === true };
}

export interface StoredGoal {
  goal_type: string;
  custom_label: string | null;
  target_date: string | null;
  event_type?: string | null;
  event_priority?: string | null;
  weight_class_flag?: boolean | null;
}

// The same goal as the one stored (what the two sides agree on: the type, its words, the date and the event fields).
export function sameMainGoal(a: MainGoalInput, b: StoredGoal | null | undefined): boolean {
  if (!b) return false;
  return (
    a.goalType === b.goal_type &&
    (a.customLabel ?? null) === ((b.goal_type === "custom" ? b.custom_label?.trim() : null) || null) &&
    (a.targetDate ?? null) === (b.target_date ?? null) &&
    (a.eventType ?? null) === (b.event_type ?? null) &&
    (a.eventPriority ?? null) === (b.event_priority ?? null) &&
    a.weightClassFlag === !!b.weight_class_flag
  );
}

// The columns a main goal writes (custom words, the event fields, the weight class flag only where they apply).
export function mainGoalColumns(g: MainGoalInput) {
  return {
    goal_type: g.goalType,
    custom_label: g.goalType === "custom" ? g.customLabel : null,
    target_date: g.targetDate,
    event_type: g.eventType,
    event_priority: g.eventPriority,
    weight_class_flag: g.weightClassFlag,
  };
}

// New smaller goals from the page: trimmed, cut to the table's 120 characters, blanks and repeats (of each other and of the ones already there) left out, at most 10 at once.
export function cleanNewSubGoals(raw: unknown, existing: string[] = []): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set(existing.map((t) => t.trim().toLowerCase()));
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.trim().slice(0, 120);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === 10) break;
  }
  return out;
}

// ---- the notices ----

// The one notice a send makes (bell + push), straight to the one page, open for writing.
export function goalsSentNotice(coachFirstName: string | null | undefined): { title: string; body: string } {
  const who = coachFirstName?.trim() || "Your coach";
  return { title: "Your goals", body: `${who} sent your goals to fill in.` };
}
export const goalsPagePath = (groupId: string) => `/groups/${groupId}/goal?edit=1`;
export const goalsFilledNotice = (clientName: string) => `${clientName} filled in their goals.`;

// ---- Food logged: X/7 days (replaces "Macro targets set", which was from before clients logged food) ----

// Days among the last 7 (today included, as the client's calendar has it) the client logged food, by the app's own rule (lib/food-log-adherence.ts, the same as the weekly
// check-in and Ask Spot's food summary): a skipped meal is not logging, and history brought in from another app never counts (review of 5d56dd30: an imported month read 7/7).
export function foodLoggedDays(entries: { log_date: string; status?: string | null; food_source?: string | null }[], todayKey: string): number {
  return computeAdherenceDays(loggedDateKeys(entries), todayKey, ADHERENCE_WINDOW_DAYS);
}
