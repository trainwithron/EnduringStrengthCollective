import { addDaysToKey } from "@/lib/timezone";

// The calendar's session menu (Ron, Nov 2): right-click on a computer, press and hold on a phone. Pure helpers for components/coach/session-menu.tsx.

/** How long a finger stays down before the menu opens, and how far it may drift before the press counts as a scroll instead. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP_PX = 10;

/** Duplicate books up to a year of weeks (Ron: "the next 4 weeks or 52"); the weekly booking it uses allows the same. */
export const DUPLICATE_MAX_WEEKS = 52;

const MENU_WIDTH = 224;
const MENU_HEIGHT = 200;
const EDGE = 8;

/** Where the menu's top-left corner goes: at the pointer, pulled back inside the screen when the pointer is near an edge. */
export function menuPosition(x: number, y: number, viewportWidth: number, viewportHeight: number): { left: number; top: number } {
  return {
    left: Math.max(EDGE, Math.min(x, viewportWidth - MENU_WIDTH - EDGE)),
    top: Math.max(EDGE, Math.min(y, viewportHeight - MENU_HEIGHT - EDGE)),
  };
}

function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** The line under the Duplicate form: what will be booked. */
export function duplicateSummary(firstDateKey: string, timeLabel: string, weeks: number): string {
  if (weeks <= 1) return `Books 1 session: ${dayLabel(firstDateKey)}, ${timeLabel}.`;
  const last = addDaysToKey(firstDateKey, 7 * (weeks - 1));
  return `Books ${weeks} sessions, every week at ${timeLabel}: ${dayLabel(firstDateKey)} to ${dayLabel(last)}.`;
}
