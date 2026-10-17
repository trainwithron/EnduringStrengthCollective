// Which notices the five-minute push job sends, and what their push is headed. Only notices written by the database itself (nothing else pushes them). A notice that nothing else pushes and is not here is simply
// in the app, as before. lib/notification-push.test.ts checks none of these is also pushed from code.
export const PUSHED_BY_JOB = ["booking_request", "late_change", "schedule_request", "request_decision"] as const;
export type PushedByJob = (typeof PUSHED_BY_JOB)[number];

export const STALE_PUSH_HOURS = 6;

const TITLES: Record<PushedByJob, string> = {
  booking_request: "New booking request",
  late_change: "A session changed late",
  schedule_request: "New schedule request",
  request_decision: "Your request was answered",
};

export function pushTitleFor(type: string): string {
  return (TITLES as Record<string, string>)[type] ?? "New notification";
}
