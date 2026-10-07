// A calendar day travels between the server and the browser as a plain "YYYY-MM-DD" key, never as a Date. A Date built on the server (which runs in UTC) for
// "Oct 15" is midnight UTC, which a browser in Los Angeles reads as 5 PM on Oct 14: its day number, its weekday and every date made from it are then one day
// early. A key has no zone to get wrong; the browser turns it into a local date only to read the day's own parts.

export function dateKeyOfParts(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The calendar day of a Date as seen on the machine reading it (use only for a Date built on that same machine).
export function localDateKey(d: Date): string {
  return dateKeyOfParts(d.getFullYear(), d.getMonth(), d.getDate());
}

// A local Date for the key: midnight of that day on the machine reading it, so getDate(), getDay() and getMonth() are the day's own.
export function dateFromKey(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return new Date(NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// The keys of a month in a Sunday-first grid: leading nulls up to the first weekday, then every day. The weekday of a day is its column.
export function monthCellKeys(year: number, monthIndex: number): (string | null)[] {
  const leading = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return [...Array.from({ length: leading }, () => null), ...Array.from({ length: days }, (_, i) => dateKeyOfParts(year, monthIndex, i + 1))];
}

// The seven keys of the Sunday-first week that holds `key`.
export function weekKeys(key: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return [];
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const sunday = base - new Date(base).getUTCDay() * 86400000;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday + i * 86400000);
    return dateKeyOfParts(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  });
}

// 0 = Sunday .. 6 = Saturday for a key, the same on every machine.
export function weekdayOfKey(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() : -1;
}

// The key n days after (or before, when negative) another key, by plain calendar arithmetic: no zone and no daylight-saving shift can move it.
export function addDaysToKey(key: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86400000);
  return dateKeyOfParts(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
