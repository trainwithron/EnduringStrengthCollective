// Peaking & Tapering (goal_date_aware_nutrition_and_programming_idea.md)
// — the shared event_window object, built FIRST per the research's own
// recommendation: written once by the goals system, read by both the
// (future) program-scaling engine and the nutrition engine. This is the
// one thing standing between a client and a real bug — a naive
// expenditure-aware nutrition engine would otherwise auto-cut calories
// during a taper week (volume falls 40-60%), exactly when carb-loading
// needs the opposite.
export interface EventWindow {
  targetDate: string; // "YYYY-MM-DD"
  sportType: string | null;
  expectedDurationMinutes: number | null;
  priority: "A" | "B" | "C" | null;
  weightClassFlag: boolean;
}

export interface ConfirmedGoalRow {
  status: string;
  targetDate: string | null;
  eventType: string | null;
  eventExpectedDurationMinutes: number | null;
  eventPriority: "A" | "B" | "C" | null;
  weightClassFlag: boolean;
}

// Only a CONFIRMED goal with a real target date drives real numbers —
// same governance rule as everything else in the goals system (a
// still-proposed goal never touches real behavior).
export function deriveEventWindow(goal: ConfirmedGoalRow): EventWindow | null {
  if (goal.status !== "confirmed" || !goal.targetDate) return null;
  return {
    targetDate: goal.targetDate,
    sportType: goal.eventType,
    expectedDurationMinutes: goal.eventExpectedDurationMinutes,
    priority: goal.eventPriority,
    weightClassFlag: goal.weightClassFlag,
  };
}

function daysBetween(a: Date, b: Date): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

// Whole weeks remaining until the event, from `today`. Negative once the
// event date has passed.
export function weeksUntilEvent(window: EventWindow, today: Date): number {
  const eventDate = new Date(`${window.targetDate}T00:00:00`);
  return Math.floor(daysBetween(today, eventDate) / 7);
}

export function isWithinTaperWindow(window: EventWindow, today: Date, taperWeeks: number): boolean {
  const weeksOut = weeksUntilEvent(window, today);
  return weeksOut >= 0 && weeksOut < taperWeeks;
}
