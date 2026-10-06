// Editing a coach's recurring weekly hours: the rules a window must follow, and copying one window to other days. Pure, so the Availability page and
// its tests share one set of rules. Sessions that are already booked are never touched by an edit: this only changes which times can be booked next.

export interface WindowDraft {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "HH:MM" or "HH:MM:SS"
  endTime: string;
  slotMinutes: number; // how often a bookable slot starts (and, today, how long a session lasts)
}

export interface ExistingWindow {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export const MIN_SLOT_MINUTES = 5;
export const MAX_SLOT_MINUTES = 480;

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Two windows on the same day overlap when they share any time (touching at an end point is fine: 06:00 to 12:00 and 12:00 to 17:00).
export function windowsOverlap(a: { weekday: number; startTime: string; endTime: string }, b: { weekday: number; startTime: string; endTime: string }): boolean {
  if (a.weekday !== b.weekday) return false;
  return timeToMinutes(a.startTime) < timeToMinutes(b.endTime) && timeToMinutes(a.endTime) > timeToMinutes(b.startTime);
}

// A plain sentence for the first thing wrong with a window, or null when it is fine. `ignoreId` is the window being edited.
export function validateWindow(draft: WindowDraft, others: ExistingWindow[], ignoreId?: string): string | null {
  const start = timeToMinutes(draft.startTime);
  const end = timeToMinutes(draft.endTime);
  if (!draft.startTime || !draft.endTime) return "Pick a start and an end time.";
  if (end <= start) return "End time must be after start time.";
  if (!Number.isInteger(draft.slotMinutes) || draft.slotMinutes < MIN_SLOT_MINUTES || draft.slotMinutes > MAX_SLOT_MINUTES) {
    return `Minutes per session must be a whole number from ${MIN_SLOT_MINUTES} to ${MAX_SLOT_MINUTES}.`;
  }
  if (draft.slotMinutes > end - start) return "That session is longer than the whole window.";
  const clash = others.find((o) => o.id !== ignoreId && windowsOverlap(draft, o));
  if (clash) return "That overlaps another window on the same day. Change or delete the other one first.";
  return null;
}

// Copying one window to other days: the days that can take it, and the days skipped because that day already has hours that overlap.
export function copyTargets(
  source: { weekday: number; startTime: string; endTime: string },
  selectedDays: number[],
  existing: ExistingWindow[]
): { create: number[]; skipped: number[] } {
  const create: number[] = [];
  const skipped: number[] = [];
  for (const day of Array.from(new Set(selectedDays)).sort((a, b) => a - b)) {
    if (day === source.weekday) continue;
    const clash = existing.some((o) => windowsOverlap({ weekday: day, startTime: source.startTime, endTime: source.endTime }, o));
    (clash ? skipped : create).push(day);
  }
  return { create, skipped };
}
