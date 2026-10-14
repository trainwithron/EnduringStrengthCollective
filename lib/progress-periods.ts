// The two groups of numbers at the top of the Progress tab (release CC): lifetime stats, and the same three numbers for a chosen period. All dates here are plain YYYY-MM-DD keys in the coach's own
// time zone (the page turns each timestamp into one), so nothing in this file depends on the machine's zone. Weekly is the CALENDAR week of today (Monday to Sunday), Monthly is a calendar
// month picked by name, Yearly is a calendar year picked from the years the client has data in. Pure.

export type PeriodKind = "weekly" | "monthly" | "yearly";

export interface PeriodChoice {
  kind: PeriodKind;
  month: string; // YYYY-MM, used when kind is monthly
  year: string; // YYYY, used when kind is yearly
}

export interface StatEvent {
  date: string; // YYYY-MM-DD
  volume: number;
}

export interface Stats {
  workouts: number;
  volume: number;
  prs: number;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function toUtc(key: string): number {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
}

function fromUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function addDaysKey(key: string, days: number): string {
  return fromUtc(toUtc(key) + days * 86400000);
}

// The Monday on or before the date.
export function mondayOf(key: string): string {
  const day = new Date(toUtc(key)).getUTCDay(); // 0 = Sunday
  return addDaysKey(key, -((day + 6) % 7));
}

export function inPeriod(dateKey: string, choice: PeriodChoice, todayKey: string): boolean {
  if (choice.kind === "weekly") {
    const start = mondayOf(todayKey);
    return dateKey >= start && dateKey <= addDaysKey(start, 6);
  }
  if (choice.kind === "monthly") return dateKey.slice(0, 7) === choice.month;
  return dateKey.slice(0, 4) === choice.year;
}

export function lifetimeStats(events: StatEvent[], prDates: string[]): Stats {
  return { workouts: events.length, volume: events.reduce((sum, e) => sum + e.volume, 0), prs: prDates.length };
}

export function periodStats(events: StatEvent[], prDates: string[], choice: PeriodChoice, todayKey: string): Stats {
  const inside = events.filter((e) => inPeriod(e.date, choice, todayKey));
  return {
    workouts: inside.length,
    volume: inside.reduce((sum, e) => sum + e.volume, 0),
    prs: prDates.filter((d) => inPeriod(d, choice, todayKey)).length,
  };
}

export function monthLabel(key: string): string {
  return `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

// Every month from the first day with data to the current month, newest first (so "August 2026" can be picked even when it had no workouts).
export function monthOptions(dateKeys: string[], todayKey: string): { key: string; label: string }[] {
  const first = dateKeys.length > 0 ? dateKeys.reduce((a, b) => (a < b ? a : b)) : todayKey;
  const out: { key: string; label: string }[] = [];
  let year = Number(todayKey.slice(0, 4));
  let month = Number(todayKey.slice(5, 7));
  const stopYear = Number(first.slice(0, 4));
  const stopMonth = Number(first.slice(5, 7));
  while (year > stopYear || (year === stopYear && month >= stopMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    out.push({ key, label: monthLabel(key) });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}

export function yearOptions(dateKeys: string[], todayKey: string): string[] {
  const first = dateKeys.length > 0 ? dateKeys.reduce((a, b) => (a < b ? a : b)).slice(0, 4) : todayKey.slice(0, 4);
  const out: string[] = [];
  for (let y = Number(todayKey.slice(0, 4)); y >= Number(first); y--) out.push(String(y));
  return out;
}

export function defaultChoice(todayKey: string): PeriodChoice {
  return { kind: "weekly", month: todayKey.slice(0, 7), year: todayKey.slice(0, 4) };
}

// A timestamp -> its YYYY-MM-DD in the given time zone.
export function dateKeyInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return parts;
}
