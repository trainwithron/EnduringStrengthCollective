// Where a notice opens: the item it is about, not a page the coach then has to search (Ron, Oct 19). The database functions that write a booking request or a late change give the plain "/dashboard"; the
// app sends both to the panel where they are decided (Home's late-changes panel on the computer, the same panel on the phone Home, which /dashboard opens on a phone). A recurring-session conflict opens the
// day it is on, at that session, with its choices open; a summary of several opens the list of them.
export const LATE_CHANGES_HREF = "/dashboard#late-changes";
export const RECURRING_CONFLICTS_PATH = "/recurring-conflicts";

const DECIDED_ON_HOME = new Set(["booking_request", "late_change"]);

export function noticeHref(type: string | null | undefined, linkPath: string | null | undefined): string {
  if (type && DECIDED_ON_HOME.has(type) && (!linkPath || linkPath === "/dashboard")) return LATE_CHANGES_HREF;
  return linkPath || "/";
}

/** The day page of the calendar, scrolled to one booking (its conflict choices open) when one is named. */
export function bookingDayHref(groupId: string, dateKey: string, bookingId?: string | null): string {
  return `/groups/${groupId}/calendar/${dateKey}${bookingId ? `#booking-${bookingId}` : ""}`;
}
