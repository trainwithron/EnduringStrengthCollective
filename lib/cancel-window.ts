// The coach's cancellation window, as the client's cancel button needs it: how many hours the window is when this session is INSIDE it (so the confirm can say the coach will be told and decides whether it counts), else null.
// A coach with no policy row uses the database default of 24 hours (migration 0068), the same one the cancel function applies. A session that has already started is not "inside the window" (it cannot be cancelled by the client at all).
export const DEFAULT_CANCELLATION_WINDOW_HOURS = 24;

export function insideWindowHours(startAt: Date | string, windowHours: number | null | undefined, now: Date = new Date()): number | null {
  const hours = windowHours ?? DEFAULT_CANCELLATION_WINDOW_HOURS;
  if (!(hours > 0)) return null;
  const msAhead = new Date(startAt).getTime() - now.getTime();
  return msAhead > 0 && msAhead < hours * 3600000 ? hours : null;
}
