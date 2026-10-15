import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { YourDayPanel, scheduleCalendarHref } from "@/components/coach/desktop/your-day-panel";
import type { ScheduleEntry } from "@/lib/your-day";

const session: ScheduleEntry = { id: "booking:b1", groupId: "g1", kind: "session", title: "Sawyer Jones", detail: "Group One", startAt: "2026-10-15T15:30:00Z", endAt: null, href: "/groups/g1/athletes/a1", needsPayment: false };
const klass: ScheduleEntry = { id: "class:c1", groupId: "g2", kind: "class", title: "Morning Class", detail: "5 of 8 spots taken", startAt: "2026-10-15T14:00:00Z", endAt: "2026-10-15T15:00:00Z", href: "/groups/g2/group-sessions", needsPayment: false };

describe("Your day: the time and the name are separate links", () => {
  it("the time opens the coach's calendar on that day, in the coach's own zone (an evening in Los Angeles is the next day in UTC)", () => {
    expect(scheduleCalendarHref(session, "America/Los_Angeles")).toBe("/groups/g1/calendar/2026-10-15");
    expect(scheduleCalendarHref({ groupId: "g1", startAt: "2026-10-16T03:30:00Z" }, "America/Los_Angeles")).toBe("/groups/g1/calendar/2026-10-15");
    expect(scheduleCalendarHref({ groupId: "g1", startAt: "2026-10-16T03:30:00Z" }, "UTC")).toBe("/groups/g1/calendar/2026-10-16");
  });
  it("each row has two links, side by side and never nested; the name goes where it did, the time to the calendar", () => {
    const html = renderToStaticMarkup(createElement(YourDayPanel, { schedule: [session, klass], attention: [], timezone: "America/Los_Angeles" }));
    const row = (id: string) => html.split("<li").filter((x) => x.includes(id))[0] ?? "";
    expect(html).toContain('href="/groups/g1/athletes/a1"');
    expect(html).toContain('href="/groups/g1/calendar/2026-10-15"');
    // a class has no client: its name keeps its group sessions page, its time goes to the calendar too
    expect(html).toContain('href="/groups/g2/group-sessions"');
    expect(html).toContain('href="/groups/g2/calendar/2026-10-15"');
    // never an anchor inside an anchor
    expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>).)*<a /);
    expect((html.match(/<a /g) ?? []).length).toBe(4);
    expect(row("Sawyer Jones")).toContain("Sawyer Jones");
  });
  it("the time link keeps the figures lined up and is big enough to tap on a phone", () => {
    const html = renderToStaticMarkup(createElement(YourDayPanel, { schedule: [session], attention: [], timezone: "America/Los_Angeles" }));
    const start = html.indexOf('href="/groups/g1/calendar/2026-10-15"');
    const time = html.slice(html.lastIndexOf("<a ", start), html.indexOf("</a>", start));
    expect(time).toContain("tabular-nums");
    expect(time).toContain("min-h-11");
    expect(time).toContain("min-w-11");
    expect(html).toContain("8:30 AM");
  });
});
