import { roundLoad, DEFAULT_STEP } from "@/lib/load-rounding";
import type { ProgressionTarget } from "@/lib/progressions";

// The Progression Contract's safety rules, applied AFTER a rule has worked out its number (docs/research/progression-periodization.md). Defaults are the report's recommended ones; each is a named constant
// so Ron can change a number in one place.
//   * A break: 14 to 27 days since the exercise was last done, start back at 95 percent; 28 to 55 days, 90 percent; 56 days or more, no number is suggested (the athlete is told to check with the coach).
//   * A ladder for misses (double progression): the weight is held after the 1st and 2nd consecutive miss at one weight, and after the 3rd the next goal is 90 percent of it. Only that exercise moves.
//   * Under 18 (or an age not known): a goal never jumps more than 5 lb above what was lifted last time.
//   * A session that was scheduled but not done is not a miss and does not move any number (there is simply no previous log to build on).
export const GAP_5_PCT_FROM_DAYS = 14;
export const GAP_10_PCT_FROM_DAYS = 28;
export const GAP_ASK_COACH_FROM_DAYS = 56;
export const RESET_AFTER_MISSES = 3;
export const RESET_FACTOR = 0.9;
export const MINOR_MAX_JUMP_LBS = 5;

export type GoalStatus = "suggest" | "hold" | "reset" | "ask_coach";

export interface GuardedTarget extends ProgressionTarget {
  status?: GoalStatus;
}

export interface LoggedSetPoint {
  weight: number;
  reps: number;
}

// One past session of an exercise: its counted sets (the ones at its heaviest weight are judged together).
export interface PastSession {
  sets: LoggedSetPoint[];
}

function heaviest(session: PastSession): { weight: number; sets: LoggedSetPoint[] } | null {
  if (session.sets.length === 0) return null;
  const weight = Math.max(...session.sets.map((s) => s.weight));
  return { weight, sets: session.sets.filter((s) => s.weight === weight) };
}

// A session is a miss when any set at its heaviest weight was under the bottom of the rep range.
export function sessionMissed(session: PastSession, repRangeLow: number): boolean {
  const h = heaviest(session);
  return !!h && h.sets.some((s) => s.reps < repRangeLow);
}

// How many of the most recent sessions in a row were misses at the same weight as the latest one (most recent first). 0 when the latest was not a miss.
export function consecutiveMisses(recentFirst: PastSession[], repRangeLow: number): number {
  const latest = recentFirst[0] ? heaviest(recentFirst[0]) : null;
  if (!latest || !sessionMissed(recentFirst[0], repRangeLow)) return 0;
  let n = 0;
  for (const s of recentFirst) {
    const h = heaviest(s);
    if (!h || h.weight !== latest.weight || !sessionMissed(s, repRangeLow)) break;
    n++;
  }
  return n;
}

export function daysBetween(fromIso: string | null | undefined, now: Date): number | null {
  if (!fromIso) return null;
  const t = new Date(fromIso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

export function applyContractGuards(args: {
  target: ProgressionTarget;
  // The weight lifted last time (the heaviest counted set), or null.
  previousWeight: number | null;
  daysSince: number | null;
  // Consecutive misses at the last weight (double progression only; 0 for the other models).
  missStreak: number;
  // Under 18 or age not known.
  protectedAge: boolean;
}): GuardedTarget {
  const { target, previousWeight, daysSince, missStreak, protectedAge } = args;
  if (previousWeight == null || previousWeight <= 0) return target;

  if (daysSince != null && daysSince >= GAP_ASK_COACH_FROM_DAYS) {
    const weeks = Math.floor(daysSince / 7);
    return { weight: null, reps: null, status: "ask_coach", reason: `It has been ${weeks} weeks since you last did this. Check with your coach before you load it.` };
  }
  if (daysSince != null && daysSince >= GAP_5_PCT_FROM_DAYS) {
    const factor = daysSince >= GAP_10_PCT_FROM_DAYS ? 0.9 : 0.95;
    const weight = roundLoad(previousWeight * factor, DEFAULT_STEP.lb, "down");
    return {
      weight,
      reps: target.reps,
      status: "suggest",
      reason: `It has been ${daysSince} days since you last did this, so start back lighter: ${weight} (${Math.round(factor * 100)} percent of ${previousWeight}).`,
    };
  }
  if (missStreak >= RESET_AFTER_MISSES) {
    const weight = roundLoad(previousWeight * RESET_FACTOR, DEFAULT_STEP.lb, "down");
    return { weight, reps: target.reps, status: "reset", reason: `You missed the reps at ${previousWeight} ${missStreak} times in a row, so drop to ${weight} and build back up.` };
  }
  if (missStreak >= 1) {
    return { weight: previousWeight, reps: target.reps, status: "hold", reason: `You missed the reps at ${previousWeight} last time. Stay at ${previousWeight} and try again.` };
  }
  if (protectedAge && target.weight != null && target.weight - previousWeight > MINOR_MAX_JUMP_LBS) {
    const weight = previousWeight + MINOR_MAX_JUMP_LBS;
    return { ...target, weight, status: "suggest", reason: `${target.reason ? target.reason + " " : ""}Held to a ${MINOR_MAX_JUMP_LBS} lb step up for your age: ${weight}.` };
  }
  return { ...target, status: target.status ?? "suggest" };
}
