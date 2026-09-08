export interface AvailabilityWindow {
  weekday: number;
  startTime: string; // "HH:MM" or "HH:MM:SS"
  endTime: string;
  slotDurationMinutes: number;
}

export interface CandidateSlot {
  start: Date;
  durationMinutes: number;
}

// A concrete blocked time range for one specific date — already resolved
// from whichever source (a one-off vacation block, a recurring lunch
// break) into real start/end instants, so the slot generator itself
// never needs to know the difference between the two.
export interface BlockedRange {
  start: Date;
  end: Date;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// Pure — generates candidate slots for one calendar date from a coach's
// recurring weekly windows, minus anything inside blockedRanges (vacation,
// a one-off appointment, a recurring lunch break). Doesn't know what's
// already booked; the caller filters those out separately.
export function generateSlotsForDate(
  date: Date,
  windows: AvailabilityWindow[],
  blockedRanges: BlockedRange[] = []
): CandidateSlot[] {
  const slots: CandidateSlot[] = [];
  for (const w of windows.filter((w) => w.weekday === date.getDay())) {
    const [sh, sm] = w.startTime.split(":").map(Number);
    const [eh, em] = w.endTime.split(":").map(Number);
    const start = new Date(date);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(date);
    end.setHours(eh, em, 0, 0);
    let cursor = new Date(start);
    while (cursor.getTime() + w.slotDurationMinutes * 60000 <= end.getTime()) {
      const slotEnd = new Date(cursor.getTime() + w.slotDurationMinutes * 60000);
      const blocked = blockedRanges.some((b) => overlaps(cursor, slotEnd, b.start, b.end));
      if (!blocked) {
        slots.push({ start: new Date(cursor), durationMinutes: w.slotDurationMinutes });
      }
      cursor = new Date(cursor.getTime() + w.slotDurationMinutes * 60000);
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// Resolves a coach's saved exceptions (mixed one-off and recurring rows)
// into concrete BlockedRange instants for one specific calendar date —
// the shape generateSlotsForDate actually needs.
export function resolveBlockedRangesForDate(
  date: Date,
  exceptions: {
    kind: "one_off" | "recurring";
    startAt: string | null;
    endAt: string | null;
    weekday: number | null;
    startTime: string | null;
    endTime: string | null;
  }[]
): BlockedRange[] {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const ranges: BlockedRange[] = [];
  for (const ex of exceptions) {
    if (ex.kind === "one_off" && ex.startAt && ex.endAt) {
      const start = new Date(ex.startAt);
      const end = new Date(ex.endAt);
      if (start < dayEnd && end > dayStart) {
        ranges.push({
          start: start < dayStart ? dayStart : start,
          end: end > dayEnd ? dayEnd : end,
        });
      }
    } else if (ex.kind === "recurring" && ex.weekday === date.getDay() && ex.startTime && ex.endTime) {
      const [sh, sm] = ex.startTime.split(":").map(Number);
      const [eh, em] = ex.endTime.split(":").map(Number);
      const start = new Date(date);
      start.setHours(sh, sm, 0, 0);
      const end = new Date(date);
      end.setHours(eh, em, 0, 0);
      ranges.push({ start, end });
    }
  }
  return ranges;
}

export function formatSlotTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
