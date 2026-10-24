import { isValidTimeZone } from "@/lib/format-in-timezone";

// A client the coach trains in person may never sign in or log anything themselves; their booked sessions are their real status on the
// coach's Clients list ("Next: Tue 10 AM", else "Last session Oct 21"). Null when they have no booked session in the window read.
export function clientSessionLine(starts: string[], now: Date, timeZone: string | null | undefined): string | null {
  const tz = isValidTimeZone(timeZone) ? timeZone : "UTC";
  let last: number | null = null;
  let next: number | null = null;
  for (const s of starts) {
    const t = new Date(s).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= now.getTime()) {
      if (next === null || t < next) next = t;
    } else if (last === null || t > last) last = t;
  }
  if (next !== null) {
    const d = new Date(next);
    const minutes = new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "2-digit" }).format(d);
    const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", ...(Number(minutes) === 0 ? {} : { minute: "2-digit" }) }).format(d);
    // Within the coming week the weekday is enough; further out it needs the date.
    const withinWeek = next - now.getTime() < 6 * 24 * 60 * 60 * 1000;
    const day = new Intl.DateTimeFormat("en-US", withinWeek ? { timeZone: tz, weekday: "short" } : { timeZone: tz, month: "short", day: "numeric" }).format(d);
    return withinWeek ? `Next: ${day} ${time}` : `Next: ${day}, ${time}`;
  }
  if (last !== null) return `Last session ${new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(last))}`;
  return null;
}

// Each client's booked (confirmed) session start times, from rows of bookings.
export function sessionStartsByAthlete(rows: { athlete_id: string; start_at: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const list = out.get(r.athlete_id);
    if (list) list.push(r.start_at);
    else out.set(r.athlete_id, [r.start_at]);
  }
  return out;
}
