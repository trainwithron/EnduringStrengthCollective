// The filter chips on the notifications page (Ron, Nov 19): every notice type belongs to exactly one. lib/notice-filters.test.ts checks every type the database allows has one.
export type NoticeFilter = "requests" | "messages" | "clients" | "programs" | "business" | "other";

export const NOTICE_FILTERS: { id: NoticeFilter; label: string }[] = [
  { id: "requests", label: "Requests" },
  { id: "messages", label: "Messages" },
  { id: "clients", label: "Clients" },
  { id: "programs", label: "Programs" },
  { id: "business", label: "Business" },
  { id: "other", label: "Other" },
];

export const FILTER_OF_TYPE: Record<string, NoticeFilter> = {
  // something asked, or the answer to something asked
  booking_request: "requests",
  late_change: "requests",
  schedule_request: "requests",
  schedule_applied: "requests",
  schedule_resumed: "requests",
  client_request: "requests",
  client_request_answer: "requests",
  request_decision: "requests",
  recurring_booking_conflict: "requests",
  waitlist_slot_offered: "requests",
  partner_request: "requests",
  partner_request_accepted: "requests",
  trainer_dispatch_offer: "requests",
  trainer_dispatch_question: "requests",
  pr_promotion: "requests",
  // people writing to you
  direct_message: "messages",
  comment: "messages",
  support_reply: "messages",
  org_announcement: "messages",
  // what your clients did
  goal_proposed: "clients",
  goal_answered: "clients",
  meal_plan_try: "clients",
  milestone_celebration: "clients",
  minor_consent_needed: "clients",
  nutrition_allergies_updated: "clients",
  nutrition_baseline_ready: "clients",
  nutrition_preferences_changed: "clients",
  nutrition_prompt_answered: "clients",
  session_pattern_note: "clients",
  gym_visitor_lead: "clients",
  weekly_checkin: "clients",
  // a client changed an exercise for every week of their own program (B5, step 219)
  exercise_swap: "clients",
  // training and nutrition plans
  program_assigned: "programs",
  macros_assigned: "programs",
  new_training_block: "programs",
  nutrition_target_changed: "programs",
  team_sheet_saved: "programs",
  // money, sessions, accounts and organizations
  payment_received: "business",
  payment_problem: "business",
  credits_expired: "business",
  coach_account_closed: "business",
  coach_departure_reminder: "business",
  organization_invite: "business",
  space_invite: "business",
  content_reported: "business",
  // your own account
  email_change_requested: "other",
  email_change_cancelled: "other",
  email_changed: "other",
};

export function filterOfType(type: string | null | undefined): NoticeFilter {
  return (type && FILTER_OF_TYPE[type]) || "other";
}
