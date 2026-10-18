// Which notices the five-minute push job sends, and what their push is headed. Only notices written by the database itself (nothing else pushes them). A notice that nothing else pushes and is not here is simply
// in the app, as before. lib/notification-push.test.ts checks none of these is also pushed from code.
export const PUSHED_BY_JOB = ["booking_request", "late_change", "schedule_request", "request_decision", "content_reported"] as const;
export type PushedByJob = (typeof PUSHED_BY_JOB)[number];

// A notice older than this is not news and is closed without a push. Long enough that a notice made at the start of a long quiet-hours window (22:00 to 07:00) is still pushed when the window ends.
export const STALE_PUSH_HOURS = 16;

// What the phone is shown for each: the kind of thing, never a name (the details are in the app). A person who turns the private lock screen on sees even less.
const BODIES: Record<PushedByJob, string> = {
  booking_request: "Open the app to answer it.",
  late_change: "Open the app to see it.",
  schedule_request: "Open the app to answer it.",
  request_decision: "Open the app to see the answer.",
  content_reported: "Open the app to review it.",
};
export function pushBodyFor(type: string): string {
  return (BODIES as Record<string, string>)[type] ?? "Open the app to see it.";
}

const TITLES: Record<PushedByJob, string> = {
  booking_request: "New booking request",
  late_change: "A session changed late",
  schedule_request: "New schedule request",
  request_decision: "Your request was answered",
  content_reported: "A post was reported",
};

export function pushTitleFor(type: string): string {
  return (TITLES as Record<string, string>)[type] ?? "New notification";
}
