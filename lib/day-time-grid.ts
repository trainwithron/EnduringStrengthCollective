// Pure helpers for the calendar's expanded day: a vertical time axis the coach drops a client onto. Everything here is in minutes since midnight on the
// COACH's clock (the page renders on a server in UTC, and a 6:00 AM session must sit at 6:00 whatever the browser's zone is).

export const PX_PER_MINUTE = 1.1;
export const SNAP_CHOICES = [5, 15] as const;
export type SnapMinutes = (typeof SNAP_CHOICES)[number];

// "06:30" or "06:30:00" -> 390.
export function parseClockMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function clockLabel(minutes: number): string {
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// "6:30 AM" style, for labels the coach reads.
export function clockLabel12(minutes: number): string {
  const total = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// Minutes since midnight of the given instant on the given IANA clock.
export function minutesOfDayInZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function snapMinutes(minutes: number, step: number): number {
  return Math.round(minutes / step) * step;
}

export interface Span {
  startMin: number;
  endMin: number;
}

// The visible range: at least the usual working day, widened (to whole hours) to hold every window, session and time-off span, and never beyond the day.
export function gridRange(spans: Span[], defaultStart = 6 * 60, defaultEnd = 20 * 60): Span {
  let start = defaultStart;
  let end = defaultEnd;
  for (const s of spans) {
    if (s.endMin <= s.startMin) continue;
    start = Math.min(start, s.startMin);
    end = Math.max(end, s.endMin);
  }
  return { startMin: Math.max(0, Math.floor(start / 60) * 60), endMin: Math.min(24 * 60, Math.ceil(end / 60) * 60) };
}

// Where a pointer at `offsetY` pixels below the top of the track lands, snapped, and kept inside the range so that a session of `lengthMin` starting there
// still ends inside it.
export function minuteFromOffset(offsetY: number, range: Span, step: number, lengthMin: number, pxPerMinute = PX_PER_MINUTE): number {
  const raw = range.startMin + offsetY / pxPerMinute;
  const snapped = snapMinutes(raw, step);
  const latest = Math.max(range.startMin, range.endMin - lengthMin);
  return Math.min(latest, Math.max(range.startMin, snapped));
}

export function offsetFromMinute(minute: number, range: Span, pxPerMinute = PX_PER_MINUTE): number {
  return (minute - range.startMin) * pxPerMinute;
}

export interface Placed<T> {
  item: T;
  lane: number;
  lanes: number;
}

// Overlapping sessions sit side by side instead of on top of each other: each gets the first lane free at its start, and every session in a connected
// overlap shares the same lane count so the widths line up.
export function assignLanes<T extends Span>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const placed: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const p of group) p.lanes = lanes;
    placed.push(...group);
    group = [];
    laneEnds.length = 0;
  };
  for (const item of sorted) {
    if (group.length > 0 && item.startMin >= groupEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    group.push({ item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  flush();
  return placed;
}

export type PlacementProblem = "taken" | "buffer" | "outside" | null;

// How a session of [startMin, endMin) sits against the day: "taken" overlaps another session, "buffer" is only within the gap of one, "outside" is not
// inside any open window or runs into time off. A warning for the coach, never a block (the coach books at any time).
export function placementProblem(input: {
  startMin: number;
  endMin: number;
  sessions: Span[];
  windows: Span[];
  blocked: Span[];
  bufferMin: number;
}): PlacementProblem {
  const { startMin, endMin, sessions, windows, blocked, bufferMin } = input;
  if (sessions.some((s) => startMin < s.endMin && endMin > s.startMin)) return "taken";
  if (bufferMin > 0 && sessions.some((s) => startMin < s.endMin + bufferMin && endMin > s.startMin - bufferMin)) return "buffer";
  const inWindow = windows.some((w) => startMin >= w.startMin && endMin <= w.endMin);
  const inBlocked = blocked.some((b) => startMin < b.endMin && endMin > b.startMin);
  if (!inWindow || inBlocked) return "outside";
  return null;
}

export const PLACEMENT_TEXT: Record<Exclude<PlacementProblem, null>, string> = {
  taken: "This overlaps another session. You can still book it.",
  buffer: "This is closer to another session than your gap. You can still book it.",
  outside: "This is outside your open hours or on your time off. You can still book it.",
};
