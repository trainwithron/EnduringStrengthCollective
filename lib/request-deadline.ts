// When a session request must be answered by (Ron, Nov 20, wave 3 C1). Nothing here changes WHEN a request lapses: the database closes a waiting request when the session's time
// arrives (expire_stale_booking_requests: a request to move a session lapses at the session's ORIGINAL time, a new-session request at the time asked for). This only says it
// out loud: "Answer by 4:00 PM" on the request, a warning about two hours before, and what happened once it lapsed.
// A weekly-schedule change never lapses (it takes effect on its day) and a request to train with the coach never does either, so neither has an "Answer by".
//
// C9: a request for a session that starts soon (its deadline within 12 hours of the request being sent) is URGENT: its push reaches the coach even in their quiet hours, and
// the client is then not told to expect a reply in the morning.

export const LAPSE_WARNING_BEFORE_MS = 2 * 3600000;
export const URGENT_WITHIN_MS = 12 * 3600000;

export interface RequestTimes {
  kind?: string | null;
  from_start_at?: string | null;
  new_start_at: string;
}

/** The moment the request lapses if nobody answers it. */
export function requestDeadline(r: RequestTimes): string {
  return r.kind === "move" && r.from_start_at ? r.from_start_at : r.new_start_at;
}

/** Sent less than 12 hours before it would lapse (C9). */
export function isUrgentRequest(r: RequestTimes & { created_at: string }): boolean {
  const lapse = new Date(requestDeadline(r)).getTime();
  const sent = new Date(r.created_at).getTime();
  return Number.isFinite(lapse) && Number.isFinite(sent) && lapse - sent <= URGENT_WITHIN_MS;
}

const dayKey = (at: Date, timeZone: string) => at.toLocaleDateString("en-CA", { timeZone });
const clock = (at: Date, timeZone: string) => at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });

/** "4:00 PM" today, "tomorrow 9:00 AM", else "Thu Nov 20, 9:00 AM", in the coach's own time zone. */
export function deadlineWhen(deadlineIso: string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(deadlineIso);
  const today = dayKey(now, timeZone);
  const tomorrow = dayKey(new Date(now.getTime() + 86400000), timeZone);
  const key = dayKey(at, timeZone);
  if (key === today) return clock(at, timeZone);
  if (key === tomorrow) return `tomorrow ${clock(at, timeZone)}`;
  return at.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
}

/** "Answer by 4:00 PM" */
export function answerByText(deadlineIso: string, timeZone: string, now: Date = new Date()): string {
  return `Answer by ${deadlineWhen(deadlineIso, timeZone, now)}`;
}

/** From the client's side, just after sending: the request lapses within 12 hours, so the coach is told even in their quiet hours (C9) and no "reply in the morning" is promised. */
export function lapsesSoon(lapsesAtIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!lapsesAtIso) return false;
  const left = new Date(lapsesAtIso).getTime() - now.getTime();
  return Number.isFinite(left) && left <= URGENT_WITHIN_MS;
}

/** Due for the two-hour warning now (inside the last two hours, not lapsed yet). */
export function dueForLapseWarning(deadlineIso: string, now: Date = new Date()): boolean {
  const left = new Date(deadlineIso).getTime() - now.getTime();
  return left > 0 && left <= LAPSE_WARNING_BEFORE_MS;
}

/** The coach's warning: "Answer by 4:00 PM or it lapses. Hewan B. asked for Thu Nov 20, 4:00 PM." */
export function lapseWarningMessage(who: string, what: string, deadlineIso: string, timeZone: string, now: Date = new Date()): { title: string; body: string } {
  return { title: "A request is about to lapse", body: `${answerByText(deadlineIso, timeZone, now)} or it lapses. ${who} asked ${what}.` };
}

/** After it lapsed: who, what, and that the client was told. */
export function lapsedMessage(who: string, what: string): { title: string; body: string } {
  return { title: "A request lapsed", body: `${who} asked ${what}. Nobody answered before the time came, so it lapsed. ${who} was told.` };
}

const PUSH_WHEN = (iso: string, timeZone: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });

/** "for Thu Nov 20, 4:00 PM" or "to move Thu Nov 20, 4:00 PM to Fri Nov 21, 9:00 AM" (what the client asked). */
export function askedWhat(r: RequestTimes, timeZone: string): string {
  if (r.kind === "move" && r.from_start_at) return `to move ${PUSH_WHEN(r.from_start_at, timeZone)} to ${PUSH_WHEN(r.new_start_at, timeZone)}`;
  return `for ${PUSH_WHEN(r.new_start_at, timeZone)}`;
}
