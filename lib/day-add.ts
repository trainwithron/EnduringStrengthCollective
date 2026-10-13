// Pure helpers for the "tap a time, add something" sheet on the coach's day view. Tested.

export type AddKind = "session" | "event" | "block";

export function addTimeChoices(): { kind: AddKind; label: string }[] {
  return [
    { kind: "session", label: "Client session" },
    { kind: "event", label: "Event" },
    { kind: "block", label: "Block time" },
  ];
}

// "HH:MM" typed or picked (any minute: 10:22 is fine). Null when it is not a time.
export function parseTimeInput(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// Nudge by minutes, staying inside the same day.
export function shiftTime(value: string, deltaMinutes: number): string {
  const p = parseTimeInput(value) ?? { hour: 9, minute: 0 };
  const total = Math.max(0, Math.min(24 * 60 - 1, p.hour * 60 + p.minute + deltaMinutes));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// A warning, never a block: the coach decides. Null when there is nothing to say.
export function overlapWarning(
  startMs: number,
  endMs: number,
  busy: { startMs: number; endMs: number }[],
  open: { startMs: number; endMs: number }[],
  kind: AddKind
): string | null {
  if (busy.some((b) => b.startMs < endMs && b.endMs > startMs)) return "This overlaps another session.";
  if (kind === "session" && !open.some((o) => o.startMs <= startMs && endMs <= o.endMs)) return "This is outside your open hours. You can still add it.";
  return null;
}

// The dropdown under Start and End lists every 15 minutes (a typed minute such as 10:22 is still accepted).
export function timeOptions15(): string[] {
  return Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
}

function toMinutes(value: string): number | null {
  const p = parseTimeInput(value);
  return p ? p.hour * 60 + p.minute : null;
}

// Minutes from start to end on the same day, or null when either is not a time or end is not after start.
export function minutesBetween(start: string, end: string): number | null {
  const a = toMinutes(start);
  const b = toMinutes(end);
  if (a === null || b === null || b <= a) return null;
  return b - a;
}

// The end time that is `minutes` after start, capped at the end of the day.
export function endFrom(start: string, minutes: number): string {
  return shiftTime(start, minutes);
}
