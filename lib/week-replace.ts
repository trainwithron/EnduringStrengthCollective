// Which days a "Build the week" may write. A week build never touches a day that has already passed (what the client was shown, and "What they ate", must stay as it was) and, by
// default, never a day the coach built by hand (the planner's day save, drag and drop, "Assign to days"). Days the library built earlier, and empty days, are fair game.
// A day the library built is recognised by its rationale (the text the build writes), which a hand-made plan never has.
import { dateFromKey } from "@/lib/date-key";

export const LIBRARY_WEEK_RATIONALE = "Built from the recipe library for the week.";

export interface ExistingDay {
  log_date: string;
  rationale: string | null;
}

export interface WeekReplacementPlan {
  // Days that will be written, in date order.
  write: string[];
  // Of those, the days that already had a plan the library built earlier (replaced).
  replacingLibrary: string[];
  // Of those, the days a coach built by hand (only when the coach chose to replace those too).
  replacingHand: string[];
  skippedPast: string[];
  skippedHand: string[];
}

export function planWeekReplacement(args: { dates: string[]; todayKey: string; existing: ExistingDay[]; replaceHandBuilt: boolean }): WeekReplacementPlan {
  const byDate = new Map(args.existing.map((e) => [e.log_date, e]));
  const plan: WeekReplacementPlan = { write: [], replacingLibrary: [], replacingHand: [], skippedPast: [], skippedHand: [] };
  for (const d of [...args.dates].sort()) {
    if (d < args.todayKey) {
      plan.skippedPast.push(d);
      continue;
    }
    const e = byDate.get(d);
    if (!e) {
      plan.write.push(d);
      continue;
    }
    if (e.rationale === LIBRARY_WEEK_RATIONALE) {
      plan.write.push(d);
      plan.replacingLibrary.push(d);
    } else if (args.replaceHandBuilt) {
      plan.write.push(d);
      plan.replacingHand.push(d);
    } else {
      plan.skippedHand.push(d);
    }
  }
  return plan;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "Mon Oct 5"
export function dayLabel(key: string): string {
  const d = dateFromKey(key);
  return `${WEEKDAY[d.getDay()]} ${MONTH[d.getMonth()]} ${d.getDate()}`;
}
export const dayList = (keys: string[]): string => keys.map(dayLabel).join(", ");
