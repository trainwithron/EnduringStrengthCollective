import { countByIds } from "@/lib/read-by-ids";
import { addDaysToKey, dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";

// One quiet line at the top of the coach's Calendar (Ron, Oct 19): how many sessions the week and the month being looked at hold. It counts what the grid shows: confirmed one-on-one sessions plus the small-group classes
// and group events on the calendar, once each (a group item's hidden stand-in booking is not counted twice). Cancelled sessions are not counted. Only the open organization's groups.
export interface CountRanges {
  weekFromKey: string;
  weekToKey: string; // exclusive
  monthFromKey: string;
  monthToKey: string; // exclusive
  weekIsCurrent: boolean;
  monthIsCurrent: boolean;
  monthName: string;
  weekLabel: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const firstOfMonthKey = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, "0")}-01`;

/**
 * The week and the month to count. `weekStartKey` is the first day (Sunday, as the grid draws it) of the week on screen; in the month view the week counted is the one holding today when today is in the viewed month, else
 * the one holding the 1st. In the week view the month counted is the one holding the middle of that week.
 */
export function countRanges(opts: { view: "month" | "week"; year: number; monthIndex: number; weekStartKey: string | null; todayKey: string }): CountRanges {
  const { view, todayKey } = opts;
  const sundayOf = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return addDaysToKey(key, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  };
  let y = opts.year;
  let m0 = opts.monthIndex;
  let weekStart: string;
  if (view === "week" && opts.weekStartKey) {
    weekStart = opts.weekStartKey;
    const mid = addDaysToKey(weekStart, 3);
    y = Number(mid.slice(0, 4));
    m0 = Number(mid.slice(5, 7)) - 1;
  } else {
    const first = firstOfMonthKey(y, m0);
    weekStart = sundayOf(todayKey.slice(0, 7) === first.slice(0, 7) ? todayKey : first);
  }
  const monthFromKey = firstOfMonthKey(y, m0);
  const monthToKey = m0 === 11 ? firstOfMonthKey(y + 1, 0) : firstOfMonthKey(y, m0 + 1);
  const weekToKey = addDaysToKey(weekStart, 7);
  const [, wm, wd] = weekStart.split("-").map(Number);
  return {
    weekFromKey: weekStart,
    weekToKey,
    monthFromKey,
    monthToKey,
    weekIsCurrent: todayKey >= weekStart && todayKey < weekToKey,
    monthIsCurrent: todayKey >= monthFromKey && todayKey < monthToKey,
    monthName: MONTHS[m0],
    weekLabel: `Week of ${SHORT[wm - 1]} ${wd}`,
  };
}

export const sessionWord = (n: number): string => `${n} ${n === 1 ? "session" : "sessions"}`;

/** "This week: 9 sessions · This month: 38 sessions", or the named week and month when they are not the current ones. */
export function countLine(ranges: CountRanges, week: number, month: number): string {
  const weekPart = `${ranges.weekIsCurrent ? "This week" : ranges.weekLabel}: ${sessionWord(week)}`;
  const monthPart = `${ranges.monthIsCurrent ? "This month" : ranges.monthName}: ${sessionWord(month)}`;
  return `${weekPart} · ${monthPart}`;
}

/** The sessions in [fromKey, toKey) on the coach's clock, or null when a read failed (the line then says nothing rather than a wrong number). */
export async function countSessionsInRange(supabase: any, coachId: string, groupIds: string[], fromKey: string, toKey: string, timezone: string): Promise<number | null> {
  const fromIso = zonedTimeToUtc(fromKey, "00:00", timezone).toISOString();
  const toIso = zonedTimeToUtc(toKey, "00:00", timezone).toISOString();
  const bookings = await countByIds(groupIds, (g) =>
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("coach_id", coachId).in("group_id", g).eq("status", "confirmed").gte("start_at", fromIso).lt("start_at", toIso)
  );
  const items = await countByIds(groupIds, (g) =>
    supabase.from("group_sessions").select("id", { count: "exact", head: true }).eq("coach_id", coachId).in("group_id", g).eq("status", "scheduled").gte("start_at", fromIso).lt("start_at", toIso)
  );
  const standIns = await countByIds(groupIds, (g) =>
    supabase.from("group_sessions").select("id", { count: "exact", head: true }).eq("coach_id", coachId).in("group_id", g).eq("status", "scheduled").not("anchor_booking_id", "is", null).gte("start_at", fromIso).lt("start_at", toIso)
  );
  if (bookings.failed || items.failed || standIns.failed) return null;
  return Math.max(0, bookings.count - standIns.count) + items.count;
}

export { dateKeyInZone };
