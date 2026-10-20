import { addDaysToKey } from "@/lib/timezone";

// The day Today's food shows (Ron, Oct 20: "‹ Yesterday · Today · Tomorrow ›"). Today by default, in the same calendar day the rest of the page uses; up to a week back (to log what
// was missed) and a week ahead (to see the plan and log ahead). The day is in the address (?day=YYYY-MM-DD), so the same section simply re-renders for it. Pure.

export const FOOD_DAY_RANGE = 7;

const KEY = /^\d{4}-\d{2}-\d{2}$/;

// Whole days from `from` to `to` (both YYYY-MM-DD), counted on the calendar.
export function daysBetween(from: string, to: string): number {
  const ms = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  return Math.round(ms / 86_400_000);
}

// The day asked for in the address when it is a real date within the week either side of today; otherwise today.
export function shownFoodDay(param: string | null | undefined, todayKey: string): string {
  if (typeof param !== "string" || !KEY.test(param)) return todayKey;
  // A real calendar date ("2026-02-30" is not one).
  const d = new Date(`${param}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== param) return todayKey;
  return Math.abs(daysBetween(todayKey, param)) <= FOOD_DAY_RANGE ? param : todayKey;
}

// "Today", "Yesterday", "Tomorrow", otherwise the short date ("Mon, Oct 13").
export function foodDayLabel(key: string, todayKey: string): string {
  const diff = daysBetween(todayKey, key);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export interface FoodDayStep {
  key: string;
  label: string;
}

// The switcher for the shown day: the day before and the day after (null at the edge of the week), and the shown day's own name.
export function foodDaySwitcher(shownKey: string, todayKey: string): { prev: FoodDayStep | null; current: string; next: FoodDayStep | null; isToday: boolean } {
  const step = (days: number): FoodDayStep | null => {
    const key = addDaysToKey(shownKey, days);
    return Math.abs(daysBetween(todayKey, key)) <= FOOD_DAY_RANGE ? { key, label: foodDayLabel(key, todayKey) } : null;
  };
  return { prev: step(-1), current: foodDayLabel(shownKey, todayKey), next: step(1), isToday: shownKey === todayKey };
}

// The address of a day on the Nutrition page: today has no ?day= at all.
export function foodDayHref(groupId: string, key: string, todayKey: string): string {
  return key === todayKey ? `/groups/${groupId}/nutrition` : `/groups/${groupId}/nutrition?day=${key}`;
}

// The section's heading and the totals line for the shown day.
export function foodDayHeading(shownKey: string, todayKey: string): string {
  const label = foodDayLabel(shownKey, todayKey);
  return label === "Today" || label === "Yesterday" || label === "Tomorrow" ? `${label}'s food` : `Food for ${label}`;
}
export function loggedTotalsTitle(shownKey: string, todayKey: string): string {
  const label = foodDayLabel(shownKey, todayKey);
  if (label === "Today") return "Logged so far today";
  if (label === "Yesterday" || label === "Tomorrow") return `Logged ${label.toLowerCase()}`;
  return `Logged for ${label}`;
}
