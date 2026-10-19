import { addDaysToKey, dateKeyInZone } from "@/lib/timezone";

// The Spotlight overlay's Clients list is ordered by who is coming up (Ron, Oct 19: "If it's 7:55 and I pull up the list it should put my 8 at the top of the list"):
//   1. clients whose next confirmed session is TODAY, soonest first (a session that started in the last 30 minutes and is not finished still counts, so it stays on top),
//   2. clients whose next session is on a later day, soonest first,
//   3. everyone else, alphabetically.
// A session's own time sits under the name in small grey text ("Today 8:00 AM") so the order explains itself.

export const STAYS_ON_TOP_MS = 30 * 60 * 1000;
// Sessions are read from this long before now (so the one that just started is found) to this many days ahead.
export const NEXT_SESSION_LOOKAHEAD_DAYS = 45;

// The earliest of the session starts that is still "next": not started more than 30 minutes ago.
export function nextSessionStart(startsIso: string[], now: Date = new Date()): string | null {
  const cutoff = now.getTime() - STAYS_ON_TOP_MS;
  let best: string | null = null;
  let bestMs = Infinity;
  for (const s of startsIso) {
    const ms = new Date(s).getTime();
    if (Number.isNaN(ms) || ms < cutoff) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = s;
    }
  }
  return best;
}

export function orderByNextSession<T>(clients: T[], opts: { nextOf: (c: T) => string | null | undefined; nameOf: (c: T) => string; timezone: string; now?: Date }): T[] {
  const now = opts.now ?? new Date();
  const today = dateKeyInZone(opts.timezone, now);
  const rank = (c: T): { group: number; ms: number } => {
    const next = opts.nextOf(c);
    if (!next) return { group: 2, ms: 0 };
    return { group: dateKeyInZone(opts.timezone, new Date(next)) === today ? 0 : 1, ms: new Date(next).getTime() };
  };
  return clients
    .map((c) => ({ c, r: rank(c) }))
    .sort((a, b) => a.r.group - b.r.group || (a.r.group < 2 ? a.r.ms - b.r.ms : 0) || opts.nameOf(a.c).localeCompare(opts.nameOf(b.c)))
    .map((x) => x.c);
}

// "Today 8:00 AM", "Tomorrow 9:00 AM", "Wed, Oct 21 9:00 AM", on the coach's clock.
export function nextSessionLabel(startIso: string, timezone: string, now: Date = new Date()): string {
  const start = new Date(startIso);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(start);
  const key = dateKeyInZone(timezone, start);
  const today = dateKeyInZone(timezone, now);
  if (key === today) return `Today ${time}`;
  if (key === addDaysToKey(today, 1)) return `Tomorrow ${time}`;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(start);
  return `${day} ${time}`;
}
