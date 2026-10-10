import { firstDateOnOrAfter, weekdayOfDateKey } from "@/lib/series-schedule";
import { MAX_FIXED_WEEKS } from "@/lib/series-schedule";

// Several weekly days at once ("Monday 6:00 AM and Thursday 3:00 PM"). Each day row becomes its own weekly series (pause or end one without the others); this file is
// only the arithmetic the form needs: where each row starts, and how many dates to book when the coach picks "until their sessions run out".

export interface DayRow {
  id: number;
  // 0 (Sunday) to 6, or null = the same weekday as the Starting date (a single row works like the old form: pick the date, get that weekday).
  weekday: number | null;
  time: string; // "HH:MM" in the coach's zone
}

// The first date of a row: the Starting date itself, or the next one that falls on the row's weekday.
export function rowFirstDateKey(startDateKey: string, weekday: number | null): string {
  return weekday == null ? startDateKey : firstDateOnOrAfter(startDateKey, weekday);
}

export function rowWeekday(startDateKey: string, weekday: number | null): number {
  return weekday == null ? weekdayOfDateKey(startDateKey) : weekday;
}

export interface RowDate {
  startIso: string;
  blocking: boolean;
}

export interface RowPick {
  // How many weekly dates this row books (its series is that many weeks long), 0 = this row makes no series.
  count: number;
  // Dates inside that count that must NOT be booked (unticked, or impossible: already taken or past).
  skipStartsIso: string[];
}

export interface RunOutPlan {
  rows: RowPick[];
  // Every date that will be booked, in date order across all rows.
  booked: string[];
  // Every date shown in the preview (up to the last one booked), including the unticked and the impossible ones, in date order with its row.
  shown: { rowIndex: number; startIso: string; blocking: boolean }[];
}

// "Until their sessions run out": walk every row's dates (each row's weekly list, up to 52 weeks) in date order and book as many as the client has sessions left, counting
// only dates that can be booked and were not unticked. Unticking one therefore pulls the next date in, so the total stays at the number of sessions left. Capped at 52 weeks.
export function planRunOut(rowDates: RowDate[][], unticked: Set<string>, sessionsLeft: number): RunOutPlan {
  const all = rowDates.flatMap((dates, rowIndex) => dates.slice(0, MAX_FIXED_WEEKS).map((d, index) => ({ rowIndex, index, ...d })));
  all.sort((a, b) => a.startIso.localeCompare(b.startIso) || a.rowIndex - b.rowIndex);
  const left = Math.max(0, Math.floor(sessionsLeft));
  const booked: string[] = [];
  const shown: RunOutPlan["shown"] = [];
  const lastIndex = rowDates.map(() => -1);
  for (const d of all) {
    if (booked.length >= left) break;
    shown.push({ rowIndex: d.rowIndex, startIso: d.startIso, blocking: d.blocking });
    if (d.blocking || unticked.has(d.startIso)) continue;
    booked.push(d.startIso);
    lastIndex[d.rowIndex] = d.index;
  }
  const rows: RowPick[] = rowDates.map((dates, rowIndex) => {
    const count = lastIndex[rowIndex] + 1;
    const within = dates.slice(0, count);
    return { count, skipStartsIso: within.filter((d) => d.blocking || unticked.has(d.startIso)).map((d) => d.startIso) };
  });
  return { rows, booked, shown };
}
