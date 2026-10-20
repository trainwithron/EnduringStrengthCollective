import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { noticeHref, bookingDayHref, LATE_CHANGES_HREF, RECURRING_CONFLICTS_PATH } from "./notice-links";

// Every notice opens the item it is about (Ron, Oct 19): booking requests and late changes open the panel where they are decided; a recurring-session conflict opens that session on its day.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("where a notice opens", () => {
  it("a booking request and a late change open the late-changes panel (the database writes plain /dashboard)", () => {
    expect(noticeHref("booking_request", "/dashboard")).toBe("/dashboard#late-changes");
    expect(noticeHref("late_change", "/dashboard")).toBe(LATE_CHANGES_HREF);
    expect(noticeHref("late_change", null)).toBe(LATE_CHANGES_HREF);
  });
  it("any other notice, or one that already names a page, keeps its own link", () => {
    expect(noticeHref("booking_request", "/groups/g1/calendar")).toBe("/groups/g1/calendar");
    expect(noticeHref("message", "/groups/g1/messages/a1")).toBe("/groups/g1/messages/a1");
    expect(noticeHref("message", null)).toBe("/");
  });
  it("a booking's day, scrolled to that booking", () => {
    expect(bookingDayHref("g1", "2026-10-21", "b1")).toBe("/groups/g1/calendar/2026-10-21#booking-b1");
    expect(bookingDayHref("g1", "2026-10-21")).toBe("/groups/g1/calendar/2026-10-21");
  });
});

describe("every place a notice is opened uses it", () => {
  it("the bell, the notifications page, Home's notices, the floating inbox and the push job", () => {
    const bell = read("components/athlete/notification-bell.tsx");
    expect(bell).toContain("router.push(noticeHref(n.type, n.linkPath));");
    expect(bell).toContain("href={noticeHref(n.type, n.linkPath)}");
    expect(read("app/notifications/page.tsx")).toContain("linkPath: noticeHref(n.type, n.link_path),");
    expect(read("app/(coach)/dashboard/page.tsx")).toContain("linkPath: noticeHref(n.type, n.link_path),");
    expect(read("app/api/messages/inbox/route.ts")).toContain("linkPath: noticeHref(n.type, n.link_path)");
    expect(read("app/api/cron/notification-push/route.ts")).toContain('noticeHref(n.type, n.link_path || "/dashboard")');
  });
  it("the phone Home has the same anchors as the computer Home (/dashboard opens the phone Home on a phone)", () => {
    // on a phone /dashboard opens the coach's own app; the notice's hash opens Spotlight on that panel (Release 2)
    const phone = read("components/coach/mobile/spot-needs-top.tsx");
    expect(phone).toContain('<div data-spot-anchor="late-changes">');
    expect(phone).toContain('<div data-spot-anchor="schedule-requests">');
    expect(phone).toContain('<div data-spot-anchor="expiring">');
    expect(read("components/coach/mobile/coach-spot-hub.tsx")).toContain('export const SPOT_OPEN_HASHES = ["late-changes", "schedule-requests", "expiring"] as const;');
    expect(read("app/(coach)/dashboard/page.tsx")).toContain('<div id="late-changes">');
  });
});

describe("recurring-session conflicts point at the session", () => {
  it("one flagged session opens its day with its choices open; several open the list", () => {
    const flag = read("app/api/cron/flag-recurring-booking-conflicts/route.ts");
    expect(flag).toContain("entry.count === 1 && entry.first ? bookingDayHref(entry.first.groupId, entry.first.dateKey, entry.first.id) : RECURRING_CONFLICTS_PATH");
    expect(flag).toContain("link_path: link,");
    expect(flag).not.toContain("link_path: `/groups/${entry.groupId}/calendar`");
    const badge = read("components/coach/desktop/recurring-conflict-badge.tsx");
    expect(badge).toContain("id={`booking-${bookingId}`}");
    expect(badge).toContain("if (window.location.hash === `#booking-${bookingId}`) setOpen(true);");
  });
  it("a week the weekly schedule could not book opens that day", () => {
    const top = read("app/api/cron/series-top-up/route.ts");
    expect(top).toContain("bookingDayHref(s.group_id, dateKeyInZone(tz, new Date(taken[0].startIso)))");
    expect(top).toContain("link_path: link,");
  });
  it("the list shows the open organization's flagged sessions, each opening its own day", () => {
    const page = read("app/(coach)/recurring-conflicts/page.tsx");
    expect(RECURRING_CONFLICTS_PATH).toBe("/recurring-conflicts");
    expect(page).toContain('.eq("needs_coach_resolution", true)');
    expect(page).toContain("active.groups.filter((g) => g.orgId === active.orgId)");
    expect(page).toContain("bookingDayHref(b.group_id, dateKeyInZone(timezone, new Date(b.start_at)), b.id)");
  });
});
