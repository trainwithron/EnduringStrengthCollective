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

// Pure — generates candidate slots for one calendar date from a coach's
// recurring weekly windows. Doesn't know what's already booked; the caller
// filters those out.
export function generateSlotsForDate(date: Date, windows: AvailabilityWindow[]): CandidateSlot[] {
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
      slots.push({ start: new Date(cursor), durationMinutes: w.slotDurationMinutes });
      cursor = new Date(cursor.getTime() + w.slotDurationMinutes * 60000);
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function formatSlotTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
