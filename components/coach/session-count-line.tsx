import { createServerClient } from "@/lib/supabase/server";
import { countLine, countRanges, countSessionsInRange } from "@/lib/session-counts";
import { dateKeyInZone, zonedTimeToUtc } from "@/lib/timezone";
import { capToneClass, loadCapLines } from "@/lib/session-caps";

// One quiet line at the top of the coach's Calendar: "This week: 9 sessions · This month: 38 sessions" for the week and month on screen (it changes as the coach moves weeks and months). It counts the sessions the grid
// shows: confirmed sessions with clients plus group classes and events, once each, not cancelled ones. Nothing is drawn if a count could not be read.
// With a session cap set (Calendar > Availability, Oct 23) it adds "25 of 25 this week": amber at the cap, rust over it (counted as the cap counts: one-on-one sessions, every organization).
export async function SessionCountLine({ coachId, groupIds, timezone, view, year, monthIndex, weekStartKey }: { coachId: string; groupIds: string[]; timezone: string; view: "month" | "week"; year: number; monthIndex: number; weekStartKey: string | null }) {
  const supabase = await createServerClient();
  const ranges = countRanges({ view, year, monthIndex, weekStartKey, todayKey: dateKeyInZone(timezone) });
  const iso = (key: string) => zonedTimeToUtc(key, "00:00", timezone).toISOString();
  const [week, month, caps] = await Promise.all([
    countSessionsInRange(supabase, coachId, groupIds, ranges.weekFromKey, ranges.weekToKey, timezone),
    countSessionsInRange(supabase, coachId, groupIds, ranges.monthFromKey, ranges.monthToKey, timezone),
    loadCapLines(supabase, coachId, { weekFromIso: iso(ranges.weekFromKey), weekToIso: iso(ranges.weekToKey), monthFromIso: iso(ranges.monthFromKey), monthToIso: iso(ranges.monthToKey) }),
  ]);
  if (week === null || month === null) return null;
  return (
    <p className="font-body text-sm text-steel mb-4" aria-label="Sessions this week and this month">
      {countLine(ranges, week, month)}
      {caps.map((c) => (
        <span key={c.text} className={capToneClass(c.tone)} data-cap-line={c.tone}>
          {" · "}
          {c.text}
        </span>
      ))}
    </p>
  );
}
