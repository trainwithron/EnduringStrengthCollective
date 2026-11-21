// The weekly nudge to mark old sessions (Ron, Nov 20, wave 2 C6). A past session nobody marked waits as "to mark" on the coach's calendar (the "Did this session happen?" cards on Home
// and Calendar), and nothing settles by itself (a session only comes off a pack when the coach says it happened). Once a week, a coach who has any that ended more than a day ago gets
// ONE line with how many, and a link to the calendar where the cards are. Nothing is marked or charged by this. A coach who switched off "Bookings and cancellations" in Settings
// gets none.

// Sessions that ended within the last day are left alone (the coach may still be getting to them).
export const TO_MARK_AFTER_HOURS = 24;
// Older than this is not news any more (and a pre-launch test session from months ago should not nag forever).
export const TO_MARK_LOOK_BACK_DAYS = 60;
export const COACH_CALENDAR_PATH = "/calendar";
// At most one line per coach in this many days (only a delivered line counts, app/api/cron/sessions-to-mark).
export const NUDGE_EVERY_DAYS = 6;

export function toMarkMessage(count: number): { title: string; body: string } {
  const what = count === 1 ? "1 past session is" : `${count} past sessions are`;
  return { title: "Sessions to mark", body: `${what} waiting to be marked. Did ${count === 1 ? "it" : "they"} happen? One tap each on your calendar.` };
}

/** Each coach's count of sessions to mark, from the bookings read by the job. */
export function countByCoach(rows: { coach_id: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.coach_id, (out.get(r.coach_id) ?? 0) + 1);
  return out;
}
