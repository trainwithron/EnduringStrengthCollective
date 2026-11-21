// The Requests page (Ron, Nov 19: a session-request push "leads me to nothing", and there was no place to find requests again): everything waiting on the coach's answer in one place, and what was
// answered in the last 30 days. Four kinds: a session asked for (booking_requests), a late cancel or move to charge or waive (bookings.late_charge_state), a change to a weekly schedule
// (schedule_requests) and someone asking to train with the coach (client_requests). Every notice about one of them opens this page at that request (lib/notice-links.ts).
import { dayLabel, scheduleSummary } from "@/lib/schedule-request-ui";
import { canGiveBack, lateOutcome } from "@/lib/late-cancel-auto";

export const REQUESTS_PATH = "/requests";
export const ANSWERED_DAYS = 30;

export type RequestKind = "booking" | "late" | "schedule" | "client";
export const REQUEST_KINDS: RequestKind[] = ["booking", "late", "schedule", "client"];

/** The element id of one request on the page, waiting or answered: "request-booking-<id>". */
export function requestAnchor(kind: RequestKind, id: string): string {
  return `request-${kind}-${id}`;
}

/** A request's row, wherever it is drawn: the Requests page marks the one a notice opened (data-focused) and scrolls it clear of the top bar. */
export const FOCUSABLE_ROW = "scroll-mt-28 data-[focused=true]:bg-rust/10 data-[focused=true]:outline data-[focused=true]:outline-2 data-[focused=true]:outline-rust";

/** The page at one request. */
export function requestHref(kind: RequestKind, id: string): string {
  return `${REQUESTS_PATH}?focus=${kind}:${id}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?focus=booking:<uuid> read back; anything else is no focus. */
export function parseFocus(raw: string | string[] | undefined | null): { kind: RequestKind; id: string } | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const [kind, id] = value.split(":");
  if (!REQUEST_KINDS.includes(kind as RequestKind) || !id || !UUID.test(id)) return null;
  return { kind: kind as RequestKind, id };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** "Thu Nov 19, 9:00 AM" on the coach's clock. */
export function whenLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });
}

/** "Nov 18" on the coach's clock. */
export function dateLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
}

export interface AnsweredRequest {
  kind: RequestKind;
  id: string;
  who: string;
  // what was asked: "New session Thu Nov 19, 9:00 AM"
  what: string;
  // what was decided: "Confirmed"
  outcome: string;
  // when it was decided (null when the database keeps no time for it: a late change's charge or waive)
  decidedAt: string | null;
  // the moment it is sorted by (the decision, or for a late change the session's own time)
  sortAt: string;
  // the organization's name, for a client request when the coach belongs to more than one
  orgName?: string | null;
  // A charged late cancel the coach can give back from here (wave 2 C5, lib/late-cancel-auto.ts).
  giveBack?: boolean;
}

const BOOKING_OUTCOME: Record<string, string> = {
  confirmed: "Confirmed",
  declined: "Declined",
  expired: "Closed: the time passed",
  cancelled: "Closed: the session changed",
  pending: "Not answered: the time passed",
};

export interface BookingRequestRow {
  id: string;
  kind: string | null;
  status: string;
  from_start_at: string | null;
  new_start_at: string;
  decided_at: string | null;
  created_at: string;
  profiles?: { full_name?: string | null } | null;
}

export function bookingWhat(r: Pick<BookingRequestRow, "kind" | "from_start_at" | "new_start_at">, timeZone: string): string {
  return r.kind === "move" && r.from_start_at ? `Move ${whenLabel(r.from_start_at, timeZone)} to ${whenLabel(r.new_start_at, timeZone)}` : `New session ${whenLabel(r.new_start_at, timeZone)}`;
}

export function answeredBooking(r: BookingRequestRow, timeZone: string): AnsweredRequest {
  const at = r.decided_at ?? (r.status === "pending" ? r.new_start_at : r.created_at);
  return {
    kind: "booking",
    id: r.id,
    who: r.profiles?.full_name?.trim() || "A client",
    what: bookingWhat(r, timeZone),
    outcome: BOOKING_OUTCOME[r.status] ?? "Closed",
    decidedAt: r.decided_at ?? (r.status === "pending" ? null : r.created_at),
    sortAt: at,
  };
}

export interface LateChangeRow {
  id: string;
  start_at: string;
  late_change_kind: string | null;
  late_charge_state: string | null;
  // taken by the coach's late-cancel setting rather than by Charge (wave 2 C5)
  late_charge_auto?: boolean | null;
  profiles?: { full_name?: string | null } | null;
}

export function lateWhat(r: Pick<LateChangeRow, "late_change_kind" | "start_at">, timeZone: string): string {
  return `${r.late_change_kind === "reschedule" ? "Moved" : "Cancelled"} late: ${whenLabel(r.start_at, timeZone)}`;
}

export function answeredLate(r: LateChangeRow, timeZone: string): AnsweredRequest {
  return {
    kind: "late",
    id: r.id,
    who: r.profiles?.full_name?.trim() || "A client",
    what: lateWhat(r, timeZone),
    outcome: lateOutcome(r),
    decidedAt: null,
    sortAt: r.start_at,
    giveBack: canGiveBack(r),
  };
}

export interface ScheduleRequestRow {
  id: string;
  kind: string;
  status: string;
  effective_on: string;
  resume_on: string | null;
  applied_at: string | null;
  applied_early?: boolean | null;
  dismissed_at: string | null;
  withdrawn_at: string | null;
  created_at: string;
  profiles?: { full_name?: string | null } | null;
  recurring_booking_series?: { weekday: number; start_time: string; duration_minutes: number } | null;
}

const SCHEDULE_VERB: Record<string, string> = { pause: "Pause", freeze: "Freeze", cancel: "End" };

export function scheduleWhat(r: Pick<ScheduleRequestRow, "kind" | "effective_on" | "resume_on" | "recurring_booking_series">): string {
  const s = r.recurring_booking_series;
  const summary = s ? scheduleSummary({ weekday: s.weekday, startTime: String(s.start_time ?? "").slice(0, 5), durationMinutes: s.duration_minutes }) : "their weekly schedule";
  const until = r.kind === "freeze" && r.resume_on ? ` until ${dayLabel(r.resume_on)}` : "";
  return `${SCHEDULE_VERB[r.kind] ?? "Change"} ${summary}${until}, after ${dayLabel(r.effective_on)}`;
}

export function answeredSchedule(r: ScheduleRequestRow): AnsweredRequest {
  const decidedAt = r.status === "applied" ? r.applied_at : r.status === "dismissed" ? r.dismissed_at : r.status === "withdrawn" ? r.withdrawn_at : null;
  const outcome =
    r.status === "applied" ? (r.applied_early ? "Applied early" : "Applied") : r.status === "dismissed" ? "Marked handled" : r.status === "withdrawn" ? "Withdrawn by the client" : "Waiting";
  return { kind: "schedule", id: r.id, who: r.profiles?.full_name?.trim() || "A client", what: scheduleWhat(r), outcome, decidedAt, sortAt: decidedAt ?? r.created_at };
}

export function answeredClient(r: { id: string; display_name: string; status: string; created_at: string; decided_at: string | null }, orgName: string | null): AnsweredRequest {
  return {
    kind: "client",
    id: r.id,
    who: r.display_name || "Someone",
    what: "Asked to train with you",
    outcome: r.status === "approved" ? "Approved: now your client" : r.status === "declined" ? "Declined" : r.status === "expired" ? "Closed" : "Waiting",
    decidedAt: r.decided_at,
    sortAt: r.decided_at ?? r.created_at,
    orgName,
  };
}

/** Newest decision first; one row per request. */
export function sortAnswered(rows: AnsweredRequest[]): AnsweredRequest[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      const key = `${r.kind}:${r.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.sortAt.localeCompare(a.sortAt));
}

/** The request a request notice is about, matched by the moment it was written (the notice and the request are written by the same database call, so the same instant; a few seconds either side
 *  for safety), the closest one wins. */
export function closestByTime<T extends { created_at: string }>(rows: T[], at: string): T | null {
  const t = new Date(at).getTime();
  let best: T | null = null;
  let bestGap = Infinity;
  for (const r of rows) {
    const gap = Math.abs(new Date(r.created_at).getTime() - t);
    if (gap < bestGap) {
      best = r;
      bestGap = gap;
    }
  }
  return best;
}
