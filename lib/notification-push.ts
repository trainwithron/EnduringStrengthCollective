import { answerByText, requestDeadline } from "@/lib/request-deadline";
// Which notices the five-minute push job sends, and what their push is headed. Only notices written by the database itself (nothing else pushes them). A notice that nothing else pushes and is not here is simply
// in the app, as before. lib/notification-push.test.ts checks none of these is also pushed from code.
// client_request: someone asked to train with the coach from their public page (Ron, Oct 31: it was only on the bell, so he never heard).
export const PUSHED_BY_JOB = ["booking_request", "late_change", "schedule_request", "request_decision", "support_reply", "content_reported", "client_request"] as const;
export type PushedByJob = (typeof PUSHED_BY_JOB)[number];

// A notice older than this is not news and is closed without a push. Long enough that a notice made at the start of a long quiet-hours window (22:00 to 07:00) is still pushed when the window ends.
export const STALE_PUSH_HOURS = 16;

// What the phone is shown for each: the kind of thing, never a name (the details are in the app). A person who turns the private lock screen on sees even less.
const BODIES: Record<PushedByJob, string> = {
  booking_request: "Open the app to answer it.",
  late_change: "Open the app to see it.",
  schedule_request: "Open the app to answer it.",
  request_decision: "Open the app to see the answer.",
  support_reply: "Open the app to read it.",
  content_reported: "Open the app to review it.",
  client_request: "Open the app to answer it.",
};
export function pushBodyFor(type: string): string {
  return (BODIES as Record<string, string>)[type] ?? "Open the app to see it.";
}

const TITLES: Record<PushedByJob, string> = {
  booking_request: "New booking request",
  late_change: "A session changed late",
  schedule_request: "New schedule request",
  request_decision: "Your request was answered",
  support_reply: "A support message",
  content_reported: "A post was reported",
  client_request: "Someone asked to train with you",
};

export function pushTitleFor(type: string): string {
  return (TITLES as Record<string, string>)[type] ?? "New notification";
}

// Confirm and Decline on the booking request's notification itself (Ron, Nov 5). The phone has to say who and when to be answered from there, so such a notice shows the database's own line
// ("Oliver B. asked for a session on Thu Nov 5, 9:00 AM."); with private lock screens on, none of this is shown and there are no buttons (sendPushToProfile).

/** The request a booking-request notice is about: written in the same database call, so the same moment, coach and group. Null unless exactly one is still waiting. */
export async function waitingRequestFor(db: any, n: { profile_id: string; group_id: string | null; created_at: string }): Promise<string | null> {
  if (!n.group_id || !n.created_at) return null;
  const { data, error } = await db.from("booking_requests").select("id").eq("coach_id", n.profile_id).eq("group_id", n.group_id).eq("created_at", n.created_at).eq("status", "pending").limit(2);
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  return (data[0] as { id: string }).id;
}

/** The notice's line for the phone, without the closing "Confirm or decline." (the buttons say it). */
export function answerableBody(body: string | null | undefined): string {
  const text = (body ?? "").replace(/\s*Confirm or decline\.?\s*$/i, "").trim();
  return text || "A client asked for a session.";
}

/** What the phone shows after Confirm or Decline was pressed on the notification. */
export function requestAnswerLine(result: string): string {
  switch (result) {
    case "confirmed":
      return "Confirmed. Your client has been told.";
    case "declined":
      return "Declined. Your client has been told.";
    case "slot_taken":
      return "That time was taken first, so it was declined and your client told.";
    case "already":
      return "That request was already answered.";
    default:
      return "That request was closed: the session changed or the time passed.";
  }
}

// Who and when, on the push itself (Ron, Nov 19: "Hewan B. asked for Thu Nov 19, 9:00 AM"), for the three requests a coach answers. Read from the request the notice was written with; the
// notice's own line is the fallback. With private lock screens on, the phone is shown none of it (sendPushToProfile).
export const REQUEST_PUSH_TYPES = ["booking_request", "schedule_request", "client_request"] as const;

/** "Hewan Belete" -> "Hewan B." (the same rule as the database's client_request_short_name). */
export function shortName(full: string | null | undefined): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Someone";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

const PUSH_WHEN = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });

export function bookingRequestLine(r: { kind?: string | null; from_start_at?: string | null; new_start_at: string }, who: string, timeZone: string, now: Date = new Date()): string {
  // with when it must be answered by (wave 3 C1): it lapses at the session's time (the original time for a move)
  const by = answerByText(requestDeadline(r), timeZone, now);
  if (r.kind === "move" && r.from_start_at) return `${who} asked to move ${PUSH_WHEN(r.from_start_at, timeZone)} to ${PUSH_WHEN(r.new_start_at, timeZone)}. ${by}`;
  return `${who} asked for ${PUSH_WHEN(r.new_start_at, timeZone)}. ${by}`;
}

const SCHEDULE_ASK: Record<string, string> = { pause: "pause", freeze: "freeze", cancel: "end" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const dayOf = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : key;
};
const clockOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export function scheduleRequestLine(
  r: { kind: string; effective_on: string; resume_on?: string | null; recurring_booking_series?: { weekday: number; start_time: string } | null },
  who: string
): string {
  const s = r.recurring_booking_series;
  const what = s ? `${WEEKDAYS[s.weekday] ?? "their weekly"} at ${clockOf(String(s.start_time ?? "").slice(0, 5))}` : "their weekly schedule";
  const until = r.kind === "freeze" && r.resume_on ? ` until ${dayOf(r.resume_on)}` : "";
  return `${who} asked to ${SCHEDULE_ASK[r.kind] ?? "change"} ${what} after ${dayOf(r.effective_on)}${until}`;
}

// The one written in the same moment as the notice (another client's request a second later is not it).
function closestTo(rows: unknown, at: string): any {
  if (!Array.isArray(rows)) return null;
  const t = new Date(at).getTime();
  return rows.reduce((best: any, r: any) => (!best || Math.abs(new Date(r.created_at).getTime() - t) < Math.abs(new Date(best.created_at).getTime() - t) ? r : best), null);
}

/** The line a request push shows. The request is found as the Requests page finds it: the coach's own, written in the same moment as the notice. */
export async function requestPushLine(db: any, n: { profile_id: string; group_id: string | null; type: string; body: string | null; created_at: string }, timeZone: string): Promise<string> {
  const fallback = answerableBody(n.body);
  if (!n.created_at) return fallback;
  const at = new Date(n.created_at).getTime();
  const lo = new Date(at - 5000).toISOString();
  const hi = new Date(at + 5000).toISOString();
  try {
    if (n.type === "booking_request") {
      let q = db.from("booking_requests").select("kind, from_start_at, new_start_at, created_at, profiles!booking_requests_athlete_id_fkey ( full_name )").eq("coach_id", n.profile_id).gte("created_at", lo).lte("created_at", hi);
      if (n.group_id) q = q.eq("group_id", n.group_id);
      const { data } = await q.limit(10);
      const r = closestTo(data, n.created_at);
      return r ? bookingRequestLine(r, shortName(r.profiles?.full_name), timeZone) : fallback;
    }
    if (n.type === "schedule_request") {
      let q = db
        .from("schedule_requests")
        .select("kind, effective_on, resume_on, created_at, profiles!schedule_requests_athlete_id_fkey ( full_name ), recurring_booking_series ( weekday, start_time )")
        .eq("coach_id", n.profile_id)
        .gte("created_at", lo)
        .lte("created_at", hi);
      if (n.group_id) q = q.eq("group_id", n.group_id);
      const { data } = await q.limit(10);
      const r = closestTo(data, n.created_at);
      return r ? scheduleRequestLine(r, shortName(r.profiles?.full_name)) : fallback;
    }
    if (n.type === "client_request") {
      const { data } = await db.from("client_requests").select("created_at, profiles!client_requests_requester_id_fkey ( full_name )").eq("coach_id", n.profile_id).gte("created_at", lo).lte("created_at", hi).limit(10);
      const r = closestTo(data, n.created_at);
      return r ? `${shortName(r.profiles?.full_name)} asked to train with you` : fallback;
    }
  } catch {
    // the notice's own line
  }
  return fallback;
}
