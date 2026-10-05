import { GOAL_TYPE_LABELS } from "./goal-types";
import type { GoalType } from "./goal-reversal";
import { getWeekRange, isWithinRange } from "./week-range";

// The "thread" above Today on a client's Home: where they are going (their confirmed goal), where they are in the program, and how steadily
// they have been showing up. Each part appears only when there is something true to say; with none of them, nothing is shown.

export interface ThreadGoal {
  goalType: string;
  customLabel: string | null;
  targetDate: string | null; // YYYY-MM-DD
  status: string;
}

export interface ThreadProgram {
  name: string;
  unscheduled: boolean;
  startDate: string | null; // YYYY-MM-DD
  scheduledDates: Date[]; // each workout's date (scheduled programs)
  totalWorkouts: number; // unscheduled (playlist) programs
  doneWorkouts: number;
}

const DAY_MS = 86400000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const parseDay = (s: string) => new Date(`${s}T00:00:00`);

// Only a goal the coach has confirmed is shown: a proposed one does not drive anything yet.
export function describeGoal(goal: ThreadGoal | null, today: Date): string | null {
  if (!goal || goal.status !== "confirmed") return null;
  const label =
    goal.goalType === "custom"
      ? goal.customLabel?.trim() || null
      : GOAL_TYPE_LABELS[goal.goalType as GoalType] ?? null;
  if (!label) return null;
  if (!goal.targetDate) return label;
  const days = Math.round((parseDay(goal.targetDate).getTime() - startOfDay(today).getTime()) / DAY_MS);
  if (days < 0) return label;
  if (days === 0) return `${label} · goal day is today`;
  if (days < 14) return `${label} · ${days} ${days === 1 ? "day" : "days"} to go`;
  const weeks = Math.round(days / 7);
  return `${label} · ${weeks} weeks to go`;
}

export function describeProgramPosition(program: ThreadProgram | null, today: Date): string | null {
  if (!program) return null;
  if (program.unscheduled) {
    if (program.totalWorkouts <= 0) return null;
    if (program.doneWorkouts >= program.totalWorkouts) return `${program.name}: finished`;
    return `${program.name}: workout ${program.doneWorkouts + 1} of ${program.totalWorkouts}`;
  }
  if (!program.startDate || program.scheduledDates.length === 0) return null;
  const start = parseDay(program.startDate);
  const t = startOfDay(today);
  const last = program.scheduledDates.reduce((a, b) => (b > a ? b : a));
  const totalWeeks = Math.max(1, Math.ceil(((startOfDay(last).getTime() - start.getTime()) / DAY_MS + 1) / 7));
  if (t < start) {
    return `${program.name}: starts ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  const week = Math.floor((t.getTime() - start.getTime()) / DAY_MS / 7) + 1;
  if (week > totalWeeks) return `${program.name}: finished`;
  return `${program.name}: week ${week} of ${totalWeeks}`;
}

// Consecutive calendar weeks (Sunday to Saturday) with at least one workout. If this week has none yet, the run through last week still
// counts: someone who trained every week up to now has not lost their streak on a Monday morning.
export function currentWeekStreak(logDates: Date[], today: Date, maxWeeksBack = 104): number {
  let cursor = new Date(today);
  const thisWeek = getWeekRange(cursor);
  if (!logDates.some((d) => isWithinRange(d, thisWeek.start, thisWeek.end))) {
    cursor = new Date(thisWeek.start);
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  for (let i = 0; i < maxWeeksBack; i++) {
    const { start, end } = getWeekRange(cursor);
    if (!logDates.some((d) => isWithinRange(d, start, end))) break;
    streak++;
    cursor = new Date(start);
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function describeStreak(weeks: number): string | null {
  // One week is just "you trained"; a streak starts at two.
  return weeks >= 2 ? `${weeks}-week streak` : null;
}

export interface HomeThreadInput {
  goal: ThreadGoal | null;
  program: ThreadProgram | null;
  logDates: Date[];
  today: Date;
}

// The lines to show, in order. Empty when there is nothing to say.
export function buildHomeThread(input: HomeThreadInput): string[] {
  return [
    describeGoal(input.goal, input.today),
    describeProgramPosition(input.program, input.today),
    describeStreak(currentWeekStreak(input.logDates, input.today)),
  ].filter((x): x is string => !!x);
}
