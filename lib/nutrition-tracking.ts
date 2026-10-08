// Calorie and nutrient tracking is for EVERY client, whatever their tier and whether or not a coach has set a target. Targets, meal plans and weekly check-ins are a
// coach-run feature (not for the "group" tier); logging what you eat is not. These are the small pure pieces the client's Nutrition page and the coach's views share.

export const NO_TARGET_LINE = "Your coach hasn't set a target yet. You can still track what you eat.";
// The group tier has no targets at all, so promising one would be wrong.
export const GROUP_TIER_NO_TARGET_LINE = "Track what you eat. Targets are not part of your plan.";
// Shown on the client's own log: their coach can read it (it is part of the data the beta notice says the coach can see).
export const COACH_CAN_SEE_LINE = "Your coach can see what you log here.";
export const noTargetLine = (coachProgramming: boolean): string => (coachProgramming ? NO_TARGET_LINE : GROUP_TIER_NO_TARGET_LINE);

// Shown to a coach looking at a client whose tier has no targets or meal plans: logging still works and is visible.
export const GROUP_TIER_COACH_NOTE = "This client is on the group tier, so targets and meal plans are not part of their plan. They can still log what they eat, and you can see it here.";

export interface LoggedFood {
  status?: string | null;
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}

export interface FoodTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

// What a day's log adds up to. A skipped meal counts for nothing; a missing number counts as zero (these are the macros the client logged, always present for a logged meal).
export function sumLoggedFood(entries: LoggedFood[]): FoodTotals {
  return entries.reduce<FoodTotals>(
    (acc, e) =>
      e.status === "skipped"
        ? acc
        : {
            calories: acc.calories + (e.calories ?? 0),
            proteinG: acc.proteinG + (e.proteinG ?? 0),
            carbsG: acc.carbsG + (e.carbsG ?? 0),
            fatG: acc.fatG + (e.fatG ?? 0),
          },
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
}

// Calories eaten per day for a trend line: only days with at least one meal that was not skipped (a day with nothing logged is a gap, not a zero), oldest first.
export function dailyCaloriesFromLog(rows: { log_date: string; status?: string | null; calories?: number | null }[]): { date: string; value: number }[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "skipped") continue;
    byDay.set(r.log_date, (byDay.get(r.log_date) ?? 0) + (r.calories ?? 0));
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value: Math.round(value) }));
}

export interface DayTargetLike {
  calories?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}

// A target counts when it carries at least a calorie or protein number.
export const hasTarget = (t: DayTargetLike | null | undefined): boolean => !!t && (t.calories != null || t.proteinG != null);
