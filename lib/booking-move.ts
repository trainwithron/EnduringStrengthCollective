import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";
import { clockLabel, minutesOfDayInZone } from "@/lib/day-time-grid";

// Moving ONE booking to another day, on the coach's own clock, keeping its time of day (Ron, Oct 19: "last week Jackson canceled Monday so we only did Tuesday and Thursday"). It stays the same booking: same row, same credit state,
// still waiting to be marked when the new day is in the past. Pure helpers; the route (app/api/bookings/move) does the checking and the write.

/** The seven days of the week that holds `dateKey`, Monday first: ["2026-10-12", ..., "2026-10-18"]. */
export function weekKeysMondayFirst(dateKey: string): string[] {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const mondayOffset = (dow + 6) % 7;
  const monday = addDaysToKey(dateKey, -mondayOffset);
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i));
}

/** A moment as "HH:MM" on the coach's clock (24-hour), for the time picker. */
export function clockTimeInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh === "24" ? "00" : hh}:${mm}`;
}

/** "14:30" -> "2:30 PM". */
export function hhmmLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Every quarter hour of the day, plus the session's own time when it is not on a quarter hour, in order. */
export function quarterHourTimes(current: string): string[] {
  const out = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
  if (!out.includes(current)) out.push(current);
  return out.sort();
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The booking's new start (an ISO instant) on `newDateKey`, at the same time of day as `startIso` in `timezone`. */
export function startOnDateKeepingTime(startIso: string, newDateKey: string, timezone: string): string {
  const minutes = minutesOfDayInZone(new Date(startIso), timezone);
  return zonedTimeToUtc(newDateKey, clockLabel(minutes), timezone).toISOString();
}

export interface MovePlan {
  ok: boolean;
  message?: string;
  startIso?: string;
  endIso?: string;
}

/** Which dates a move may land on: any real day within two years either side of today (a typo like 2062 is refused). */
export function dateKeyInRange(newDateKey: string, timezone: string, now: Date = new Date()): boolean {
  const today = dateKeyInZone(timezone, now);
  return newDateKey >= addDaysToKey(today, -730) && newDateKey <= addDaysToKey(today, 730);
}

/** "HH:MM" on a 24-hour clock, 00:00 to 23:59. */
export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// `newTime` (the calendar's Reschedule, Ron Nov 2) also changes the time of day, on the coach's clock; without it the time stays.
export function planBookingMove(input: {
  booking: { startAt: string; endAt: string; status: string; attendedAt: string | null; creditState: string; noShow?: boolean | null };
  newDateKey: unknown;
  newTime?: unknown;
  timezone: string;
  now?: Date;
}): MovePlan {
  const { booking, newDateKey, timezone } = input;
  if (!isDateKey(newDateKey)) return { ok: false, message: "That is not a real date." };
  if (input.newTime !== undefined && input.newTime !== null && !isClockTime(input.newTime)) return { ok: false, message: "That is not a real time." };
  if (!dateKeyInRange(newDateKey, timezone, input.now)) return { ok: false, message: "Pick a date within two years of today." };
  if (booking.status !== "confirmed") return { ok: false, message: "That session is not on the calendar any more." };
  if (booking.attendedAt || booking.creditState === "settled" || booking.creditState === "waived") return { ok: false, message: "That session was already marked." };
  const startIso = isClockTime(input.newTime) ? zonedTimeToUtc(newDateKey, input.newTime, timezone).toISOString() : startOnDateKeepingTime(booking.startAt, newDateKey, timezone);
  const duration = new Date(booking.endAt).getTime() - new Date(booking.startAt).getTime();
  return { ok: true, startIso, endIso: new Date(new Date(startIso).getTime() + duration).toISOString() };
}
