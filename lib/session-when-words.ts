import { addDaysToKey, dateKeyInZone } from "@/lib/timezone";

// How a session that already passed is named on the "Did X's session happen?" card (Ron, Oct 19: a card for Thursday's unmarked session read as today's 8:00): in words first, the exact date after.
//   today        "this morning (6:00 AM)"   (before noon; "this afternoon" until 5 PM, then "this evening")
//   yesterday    "yesterday (Oct 18, 8:00 AM)"
//   2-6 days     "last Thursday (Oct 15, 8:00 AM)"
//   a week+      "on Thu, Oct 8 (8:00 AM)"
// All on the coach's clock.
const dayNumber = (key: string): number => {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

export function sessionWhenInWords(startIso: string, timezone: string, now: Date = new Date()): string {
  const start = new Date(startIso);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(start);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(start)) % 24;
  const key = dateKeyInZone(timezone, start);
  const today = dateKeyInZone(timezone, now);
  const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric" }).format(start);
  if (key === today) return `${hour < 12 ? "this morning" : hour < 17 ? "this afternoon" : "this evening"} (${time})`;
  if (key === addDaysToKey(today, -1)) return `yesterday (${monthDay}, ${time})`;
  const daysAgo = dayNumber(today) - dayNumber(key);
  if (daysAgo >= 2 && daysAgo <= 6) {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(start);
    return `last ${weekday} (${monthDay}, ${time})`;
  }
  const short = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(start);
  return `on ${short} (${time})`;
}
