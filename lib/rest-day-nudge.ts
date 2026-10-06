// The rest-day nudge (Ron, Oct 6): a gentle push on a day with no workout, with limits so it never becomes noise.
//  * at most 2 in any 7 days,
//  * it stops after 3 in a row that got no response, and starts again the next time the client does something (a workout, a check-in, a habit),
//  * it names the client's own goal when they have one, so it reads as about them and not a generic reminder.

import { GOAL_TYPE_LABELS } from "./goal-types";
import type { GoalType } from "./goal-reversal";

export const REST_NUDGE_MAX_PER_WEEK = 2;
export const REST_NUDGE_STOP_AFTER_UNANSWERED = 3;
const DAY = 86400000;

export type RestNudgeDecision = { send: true } | { send: false; reason: "weekly_cap" | "unanswered" };

// `nudgeTimes`: when this client was sent a rest-day nudge (any order). `lastActivityAt`: their latest workout, check-in or habit (null if never).
// A nudge is "answered" when the client did something after it; so the unanswered ones are exactly the nudges sent after their last activity.
export function restNudgeDecision(input: { nudgeTimes: Date[]; lastActivityAt: Date | null; now: Date }): RestNudgeDecision {
  const { nudgeTimes, lastActivityAt, now } = input;
  const inLastWeek = nudgeTimes.filter((t) => now.getTime() - t.getTime() < 7 * DAY).length;
  if (inLastWeek >= REST_NUDGE_MAX_PER_WEEK) return { send: false, reason: "weekly_cap" };
  const unanswered = nudgeTimes.filter((t) => !lastActivityAt || t.getTime() > lastActivityAt.getTime()).length;
  if (unanswered >= REST_NUDGE_STOP_AFTER_UNANSWERED) return { send: false, reason: "unanswered" };
  return { send: true };
}

export function goalLabelFor(goalType: string | null | undefined, customLabel: string | null | undefined): string | null {
  if (!goalType) return null;
  if (goalType === "custom") return customLabel?.trim() || null;
  return (GOAL_TYPE_LABELS[goalType as GoalType] ?? null)?.toLowerCase() ?? null;
}

export function restDayNudgeBody(goal: string | null): string {
  return goal ? `Rest day. A quick check-in keeps you on track for your ${goal} goal.` : "Rest day. Got a minute for a quick check-in?";
}
