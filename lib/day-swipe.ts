import { addDaysToDateKey } from "@/lib/series-schedule";

// Swipe a calendar day page on a phone to go to the next or previous day (Ron, Nov 2). Pure helpers for components/shared/day-swipe-nav.tsx.

/** How far the finger must travel sideways, how much more sideways than up or down, and how quick it must be, for a swipe (not a scroll or a slow drag). */
export const SWIPE_MIN_PX = 60;
export const SWIPE_RATIO = 1.5;
export const SWIPE_MAX_MS = 800;
/** A swipe that starts this close to the screen's side is the phone's own "back" gesture; leave it to the phone. */
export const SWIPE_EDGE_PX = 24;

/** Finger moved left: the next day. Moved right: the previous day. Anything else: not a swipe. */
export function swipeDirection(dx: number, dy: number, ms: number): "next" | "prev" | null {
  if (ms > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return null;
  return dx < 0 ? "next" : "prev";
}

/** The day page one day either side, keeping the picked client and a reschedule in progress (the month it came from is dropped, so Back goes to the new day's month). */
export function daySwipeHrefs(groupId: string, dateKey: string, keep: Record<string, string | undefined>): { prev: string; next: string } {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (v) query.set(k, v);
  const q = query.toString();
  const href = (key: string) => `/groups/${groupId}/calendar/${key}${q ? `?${q}` : ""}`;
  return { prev: href(addDaysToDateKey(dateKey, -1)), next: href(addDaysToDateKey(dateKey, 1)) };
}
