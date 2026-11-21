// The rest timer's two ways of showing (Ron, Nov 21, from a live workout: "The timer needs to be able to be swiped down"): the full sheet, or a slim bar docked above the
// logger's bottom bar so the set rows, Next and Finish can be used. Only how it shows changes: the countdown, its end alert, vibration and sound run the same either way.
export type RestSheetView = "sheet" | "mini";
export type RestSheetEvent = "drag-down" | "drag-up" | "tap-handle" | "tap-mini";

export function nextRestView(view: RestSheetView, event: RestSheetEvent): RestSheetView {
  if (view === "sheet" && (event === "drag-down" || event === "tap-handle")) return "mini";
  if (view === "mini" && (event === "drag-up" || event === "tap-mini")) return "sheet";
  return view;
}

// How far a finger (or mouse) has to travel for a swipe; less is a tap.
export const SWIPE_THRESHOLD_PX = 40;

/** What a press that started at startY and ended at endY was: a swipe down, a swipe up, or neither (a tap, or a wobble). */
export function swipeDirection(startY: number, endY: number, threshold = SWIPE_THRESHOLD_PX): "down" | "up" | null {
  const dy = endY - startY;
  if (dy >= threshold) return "down";
  if (dy <= -threshold) return "up";
  return null;
}

/** The slim bar's line: "Rest 0:40", or "Rest done" for a moment after it ends. */
export function miniRestLabel(remainingLabel: string, done: boolean): string {
  return done ? "Rest done" : `Rest ${remainingLabel}`;
}

/** How much of the rest has gone by, 0 to 1, for the slim bar's progress line. */
export function restProgress(remaining: number, duration: number): number {
  if (duration <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - remaining / duration));
}
