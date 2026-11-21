// The coach's Calendar on a computer opens on the view they used last (clutter pass, Nov 21, DK28). Month stays the default when nothing is remembered.
export type CalendarView = "month" | "week";
export const CALENDAR_VIEW_KEY = "coach-calendar-view";

/**
 * What to do on open. `explicit`: the address names a view (?view=, ?month= or ?week=, which is what the Month and Week buttons and the arrows send): remember it.
 * A bare open goes to the remembered view when that is Week (the default already is Month).
 */
export function calendarViewAction(stored: string | null, view: CalendarView, explicit: boolean): "remember" | "open-week" | null {
  if (explicit) return "remember";
  if (stored === "week" && view !== "week") return "open-week";
  return null;
}

/** Reads the remembered view; private windows and blocked storage give nothing. */
export function readCalendarView(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  try {
    return storage?.getItem(CALENDAR_VIEW_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeCalendarView(storage: Pick<Storage, "setItem"> | null | undefined, view: CalendarView): void {
  try {
    storage?.setItem(CALENDAR_VIEW_KEY, view);
  } catch {
    // not remembered; the calendar still works
  }
}
