// Where a notice opens: the item it is about, not a page the person then has to search (Ron, Oct 19; Nov 19: a session-request notice "leads me to nothing"). Every place a notice is opened (the
// bell, the notifications page, Spotlight, Home's notices, the floating inbox and the phone push) goes through noticeHref, so old notices are sent to the right place too.
// - The four things a coach answers (a session asked for, a late cancel or move, a weekly-schedule change, someone asking to train with them) open the Requests page at that request. The database
//   writes them with "/dashboard" or "/clients/requests" and no request id, so the page finds the request from the notice (?notice=<id>), waiting or already answered.
// - A coach's "the schedule change was applied" notice opens the same page at that change; a client's answer to a session request opens the day of that session (/notice/<id> finds it).
// - A few notices the database writes with a page that is not the item get the item's page: macros and a new training block open Nutrition, an accepted request to train opens the person's
//   new space, an organization announcement opens the notifications list (it is the message itself; /dashboard is a coach-only page), a gym visitor lead opens the leads list.
// lib/notice-links.test.ts walks every notice type there is and checks none of them opens nowhere.
import { REQUESTS_PATH } from "@/lib/requests-center";

export const LATE_CHANGES_HREF = "/dashboard#late-changes";
export const RECURRING_CONFLICTS_PATH = "/recurring-conflicts";
export const NOTIFICATIONS_PATH = "/notifications";
export const NOTICE_RESOLVE_PREFIX = "/notice/";

// The coach answers these on the Requests page.
export const REQUEST_NOTICE_TYPES = ["booking_request", "late_change", "schedule_request", "client_request"] as const;
const REQUEST_TYPES = new Set<string>(REQUEST_NOTICE_TYPES);
// The pages the database gives them, which are not the request itself.
const REQUEST_LIST_PATHS = new Set(["", "/", "/dashboard", LATE_CHANGES_HREF, "/dashboard#schedule-requests", "/clients/requests", REQUESTS_PATH]);
// Found from the notice on the server (app/notice/[id]/route.ts).
const RESOLVED_ON_OPEN = new Set(["request_decision", "gym_visitor_lead", "support_reply", "payment_problem"]);
// A leaving coach's notices open the page with their steps (Nov 21: Home is the computer's page; on a phone it is the coach's own app, where the steps were not shown).
export const LEAVING_PATH = "/leaving";
// Written with "/dashboard" (Home) though Home is not the item (Ron, Nov 21: every notice must open what it is about, on a phone too).
const HOME_LINKS = new Set(["", "/", "/dashboard"]);

export interface NoticeRef {
  id?: string | null;
  groupId?: string | null;
}

export function noticeHref(type: string | null | undefined, linkPath: string | null | undefined, ref: NoticeRef = {}): string {
  const link = (linkPath ?? "").trim();
  const id = ref.id ?? null;
  const t = type ?? "";

  if (REQUEST_TYPES.has(t) && REQUEST_LIST_PATHS.has(link)) return id ? `${REQUESTS_PATH}?notice=${id}` : REQUESTS_PATH;
  // the coach's copy (the client's opens their own schedule)
  if (t === "schedule_applied" && (link === "/dashboard" || link === "")) return id ? `${REQUESTS_PATH}?notice=${id}` : REQUESTS_PATH;
  if (t === "request_decision" && id && /^\/groups\/[^/]+\/calendar$/.test(link)) return `${NOTICE_RESOLVE_PREFIX}${id}`;
  if (t === "gym_visitor_lead" && id && (link === "/dashboard" || link === "")) return `${NOTICE_RESOLVE_PREFIX}${id}`;
  if ((t === "macros_assigned" || t === "new_training_block") && /^\/groups\/[^/]+$/.test(link)) return `${link}/nutrition`;
  if (t === "client_request_answer" && (link === "/" || link === "") && ref.groupId) return `/groups/${ref.groupId}`;
  if (t === "org_announcement" && (link === "/dashboard" || link === "")) return NOTIFICATIONS_PATH;
  if (t === "coach_departure_reminder" && HOME_LINKS.has(link)) return LEAVING_PATH;
  // a support reply with no group: that organization's Support page; a problem with the coach's own plan: Plan & Billing (both found on open, from the organization worked in)
  if ((t === "support_reply" || t === "payment_problem") && id && HOME_LINKS.has(link)) return `${NOTICE_RESOLVE_PREFIX}${id}`;
  // to the organization's admins about a dispatch request (no coach took it, a question or a reply): the message itself; there is no admin page for a dispatch request yet
  if ((t === "trainer_dispatch_offer" || t === "trainer_dispatch_question") && HOME_LINKS.has(link)) return NOTIFICATIONS_PATH;
  return link || "/";
}

/** What a push about a notice opens: the notice itself (app/notice/[id]: marks it read and opens what it is about, on a phone too), or the given link when no notice was written. */
export function pushHrefForNotice(noticeId: string | null | undefined, fallback: string): string {
  return noticeId ? `${NOTICE_RESOLVE_PREFIX}${noticeId}` : fallback;
}

export function resolvesOnOpen(type: string): boolean {
  return RESOLVED_ON_OPEN.has(type);
}

/** The day page of the calendar, scrolled to one booking (its conflict choices open) when one is named. */
export function bookingDayHref(groupId: string, dateKey: string, bookingId?: string | null): string {
  return `/groups/${groupId}/calendar/${dateKey}${bookingId ? `#booking-${bookingId}` : ""}`;
}
