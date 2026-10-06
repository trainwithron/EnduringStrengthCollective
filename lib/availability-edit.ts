// Editing a coach's recurring weekly hours: the rules a window must follow, and copying one window to other days. Pure, so the Availability page and
// its tests share one set of rules. Sessions that are already booked are never touched by an edit: this only changes which times can be booked next.

export interface WindowDraft {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "HH:MM" or "HH:MM:SS"
  endTime: string;
  slotMinutes: number; // how often a bookable slot starts (and, unless sessionMinutes is set, how long a session lasts)
  sessionMinutes?: number | null; // how long a booked session lasts when that differs from the step (a 55-minute session in 60-minute slots)
}

export interface ExistingWindow {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

// The quick choices for how often a slot starts (any whole number from 5 to 480 can still be typed). 15 and 30 are first-class: a coach can offer a start
// every 15 minutes while each session lasts 55 (Ron, Oct 6: "be human, not tied to a system").
export const STEP_PRESETS = [15, 30, 45, 60];

// The database refuses a session longer than the step until step 32 (0287) is applied; this recognises that refusal so the screen can say so plainly.
export function isSessionRuleError(message: string | null | undefined): boolean {
  return !!message && /coach_availability_windows_session_minutes_range/.test(message);
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
  if (draft.sessionMinutes != null) {
    if (!Number.isInteger(draft.sessionMinutes) || draft.sessionMinutes < MIN_SLOT_MINUTES || draft.sessionMinutes > MAX_SLOT_MINUTES) {
      return `Session length must be a whole number from ${MIN_SLOT_MINUTES} to ${MAX_SLOT_MINUTES} minutes.`;
    }
    // A session may be longer than the time between starts (starts then overlap), but it has to fit inside the window.
    if (draft.sessionMinutes > end - start) return "A session can't be longer than the whole window.";
  }
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

// ---- The three numbers, made unmistakable (Ron, Oct 6: he set "Slot every 55" thinking it was the session length) ----
//   Slot every      how often a bookable start is offered
//   Session length  how long a booked session lasts (blank = the same as the slot)
//   Gap             the rest left between two sessions (the coach's buffer, for all their hours)
// A preview of the resulting times and a warning when the numbers fight each other. The warning never blocks: the coach decides.

function clock12(minutes: number, showPeriod: boolean): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")}${showPeriod ? (h24 < 12 ? " AM" : " PM") : ""}`;
}

// The first few sessions this window would offer, like "6:00–6:55, 7:00–7:55, 8:00–8:55 AM". The AM or PM is written only where it changes.
export function previewSessionTimes(input: { startTime: string; endTime: string; stepMinutes: number; sessionMinutes?: number | null; count?: number }): string {
  const { startTime, endTime, stepMinutes } = input;
  if (!startTime || !endTime || !Number.isInteger(stepMinutes) || stepMinutes < 1) return "";
  const length = input.sessionMinutes && input.sessionMinutes > 0 ? input.sessionMinutes : stepMinutes;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  const count = input.count ?? 3;
  const parts: string[] = [];
  let lastPeriod: "AM" | "PM" | null = null;
  const period = (m: number) => (Math.floor((((m % 1440) + 1440) % 1440) / 60) < 12 ? "AM" : "PM");
  for (let s = start; s + length <= end && parts.length < count; s += stepMinutes) {
    const pStart = period(s);
    const pEnd = period(s + length);
    // AM or PM appears on the end of a range when it changes from the one before, and on the start only when the range crosses noon or midnight.
    parts.push(`${clock12(s, pStart !== pEnd)}–${clock12(s + length, pEnd !== lastPeriod)}`);
    lastPeriod = pEnd;
  }
  if (parts.length === 0) return "";
  let more = false;
  for (let s = start + count * stepMinutes; s + length <= end; s += stepMinutes) {
    more = true;
    break;
  }
  return parts.join(", ") + (more ? ", …" : "");
}

// Null when the numbers agree. Otherwise one plain sentence, never a block.
export function timingWarning(input: { stepMinutes: number; sessionMinutes?: number | null; gapMinutes: number }): string | null {
  const { stepMinutes, gapMinutes } = input;
  const length = input.sessionMinutes && input.sessionMinutes > 0 ? input.sessionMinutes : stepMinutes;
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1) return null;
  if (length > stepMinutes) {
    return `A start is offered every ${stepMinutes} minutes but a session lasts ${length}, so starts overlap: booking one hides the starts it overlaps.`;
  }
  const left = stepMinutes - length;
  if (gapMinutes > left) {
    return `Slot every ${stepMinutes} with a ${length}-minute session leaves ${left} minutes between sessions, less than your ${gapMinutes}-minute gap, so the next start after a booking is hidden. A slot every ${length + gapMinutes} minutes or more keeps the full gap.`;
  }
  return null;
}

// One line that shows how the three fit, with this window's own numbers.
export function timingHint(input: { stepMinutes: number; sessionMinutes?: number | null; gapMinutes: number }): string {
  const length = input.sessionMinutes && input.sessionMinutes > 0 ? input.sessionMinutes : input.stepMinutes;
  return `Slot every ${input.stepMinutes}, session ${length}, gap ${input.gapMinutes}`;
}
