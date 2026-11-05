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
