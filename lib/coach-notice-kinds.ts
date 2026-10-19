// The KINDS of notice the app sends a coach, each with ONE on/off switch in Settings (Ron, Oct 19: "coaches need to be able to customize their notifications"). A switch controls both the push and the notice in the app.
// The mapping from a notice's type to its kind lives in the database too (notice_kind_of, migration 0423), where it drops a notice for someone who switched that kind off, whatever wrote it; a test keeps the two in step.
// Types that are not listed (an account closing, an invitation, an email change, a guardian's consent, a support reply...) are important and cannot be switched off.
export interface NoticeKind {
  id: string;
  label: string;
  example: string;
  /** the notification types (notifications.type) that belong to this kind */
  types: string[];
}

export const NOTICE_KINDS: NoticeKind[] = [
  { id: "low_sessions", label: "Low sessions / renewal window", example: "Oliver B. has 1 session left.", types: [] },
  { id: "bookings", label: "Bookings and cancellations", example: "A new booking, a late cancel, a schedule change request.", types: ["booking_request", "late_change", "waitlist_slot_offered", "recurring_booking_conflict", "schedule_request", "schedule_applied", "schedule_resumed", "request_decision", "trainer_dispatch_offer", "trainer_dispatch_question"] },
  { id: "messages", label: "Messages, comments and mentions", example: "A client sends you a message.", types: ["direct_message", "comment"] },
  { id: "client_activity", label: "Client activity", example: "A client finishes a workout, sends a check-in or a form-check video, answers a goal.", types: ["goal_proposed", "goal_answered", "meal_plan_try", "nutrition_allergies_updated", "nutrition_baseline_ready", "nutrition_preferences_changed", "nutrition_prompt_answered", "nutrition_target_changed"] },
  { id: "milestones", label: "Milestones and records", example: "A client hits a milestone or a new PR.", types: ["milestone_celebration", "pr_promotion"] },
  { id: "requests", label: "Requests to train with you", example: "Someone asks to train with you from your page.", types: ["client_request"] },
  { id: "session_notes", label: "Session notes", example: "A note about a pattern in a client's sessions.", types: ["session_pattern_note"] },
  { id: "payments", label: "Payments", example: "A payment arrives or fails.", types: ["payment_received", "payment_problem"] },
  { id: "briefing", label: "Daily briefing", example: "Your business, since you last checked.", types: [] },
  { id: "team", label: "Team and organization", example: "A team sheet is saved, an announcement goes out.", types: ["team_sheet_saved", "org_announcement", "gym_visitor_lead"] },
];

export type CoachNoticeKind = "low_sessions" | "bookings" | "messages" | "client_activity" | "milestones" | "requests" | "session_notes" | "payments" | "briefing" | "team";

export const KIND_IDS: readonly string[] = NOTICE_KINDS.map((k) => k.id);

export function kindOfType(type: string): CoachNoticeKind | null {
  const k = NOTICE_KINDS.find((x) => x.types.includes(type));
  return (k?.id as CoachNoticeKind | undefined) ?? null;
}

/**
 * The kind of a push that a person's browser asks the server to send (/api/push/send), read from the page the push opens: that route carries no notice type. Unknown pages are not switchable (null).
 */
export function kindFromPushUrl(url: string | null | undefined): CoachNoticeKind | null {
  const path = (url ?? "").split(/[?#]/)[0];
  if (/\/messages(\/|$)/.test(path) || /\/feed(\/|$)/.test(path)) return "messages";
  if (/\/calendar(\/|$)/.test(path)) return "bookings";
  if (/\/athletes(\/|$)/.test(path) || /\/clients(\/|$)/.test(path) || /^\/sessions\//.test(path)) return "client_activity";
  return null;
}
