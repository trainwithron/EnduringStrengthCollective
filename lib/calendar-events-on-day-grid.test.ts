import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assignLanes, gridRange, parseClockMinutes } from "./day-time-grid";

// Ron, Nov 19: "Monica and Son consult needs to show up on my calendar, silly it doesnt and i almost missed it." A calendar event with a time (17:00) showed only in the
// "Also on this day" list under the computer calendar's expanded day, never on its time grid.
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("a timed calendar event on the expanded day's time grid", () => {
  it("the expanded day gets that day's events (not an empty list), with the event's own clock time", () => {
    const grid = read("components/coach/desktop/calendar-grid.tsx");
    expect(grid).toContain("events={eventsByDateKey.get(expandedKey) ?? []}");
    expect(grid).not.toContain("events={[]}");
    expect(read("components/coach/calendar-page-body.tsx")).toContain("clock: e.event_time ?? null,");
  });
  it("is drawn at its time, beside any session there, and never takes a click (booking still works under it)", () => {
    const day = read("components/coach/desktop/day-time-grid.tsx");
    expect(day).toContain("const range = gridRange([...windowSpans, ...blockedSpans, ...sessionSpans, ...eventSpans]);");
    expect(day).toContain("assignLanes<(typeof sessionSpans)[number] | (typeof eventSpans)[number]>([...sessionSpans, ...eventSpans])");
    const at = day.indexOf("data-calendar-event");
    expect(at).toBeGreaterThan(-1);
    expect(day.slice(at, at + 300)).toContain("pointer-events-none");
    // the old one-line "Also today:" repeat is gone (the list under the grid has them, with Remove)
    expect(day).not.toContain("Also today:");
  });
  it("a 5 PM event outside the open hours still widens the grid to reach it, and shares a lane with a session at the same time", () => {
    const event = { startMin: parseClockMinutes("17:00:00"), endMin: parseClockMinutes("17:00:00") + 30 };
    expect(event.startMin).toBe(17 * 60);
    const range = gridRange([{ startMin: 6 * 60, endMin: 12 * 60 }, event]);
    expect(range.startMin).toBeLessThanOrEqual(17 * 60);
    expect(range.endMin).toBeGreaterThanOrEqual(17 * 60 + 30);
    const late = gridRange([{ startMin: 6 * 60, endMin: 12 * 60 }, { startMin: 21 * 60, endMin: 21 * 60 + 30 }]);
    expect(late.endMin).toBe(22 * 60);
    const placed = assignLanes([{ startMin: 17 * 60, endMin: 18 * 60 }, event]);
    expect(placed.map((p) => p.lanes)).toEqual([2, 2]);
    expect(new Set(placed.map((p) => p.lane)).size).toBe(2);
  });
});

describe("Home's Your day lists today's calendar events", () => {
  it("a timed event sits in time order among sessions and classes; one with no time comes first, as All day", async () => {
    const { buildSchedule } = await import("./your-day");
    const at = (h: number) => `2026-11-20T${String(h).padStart(2, "0")}:00:00.000Z`;
    const list = buildSchedule(
      "coach",
      [{ id: "b1", athleteId: "a1", groupId: "g", athleteName: "Sam", groupName: "Ron", startAt: at(23), needsPayment: false }],
      [{ id: "c1", title: "Bootcamp", startAt: at(15), endAt: at(16), capacity: 10, joined: 2, waitlisted: 0, groupId: "g" }],
      [
        { id: "e1", title: "Monica and Son consult", dateKey: "2026-11-19", startAt: at(1), timed: true, type: "custom", groupId: "g" },
        { id: "e2", title: "Program ends soon", dateKey: "2026-11-19", startAt: at(8), timed: false, type: "suggestion", groupId: "g" },
      ]
    );
    expect(list.map((e) => e.id)).toEqual(["event:e2", "event:e1", "class:c1", "booking:b1"]);
    expect(list[0]).toMatchObject({ kind: "event", allDay: true, detail: "Suggested", href: "/groups/g/calendar/2026-11-19" });
    expect(list[1]).toMatchObject({ kind: "event", allDay: false, detail: "On your calendar" });
  });
  it("Home reads only the coach's own rows for today, and the panel says All day / Event", () => {
    const page = read("app/(coach)/dashboard/page.tsx");
    expect(page).toContain('.from("calendar_events").select("id, title, event_time, event_type").eq("coach_id", user!.id).eq("event_date", todayKey).neq("status", "dismissed")');
    expect(page).toContain("buildSchedule(user.id, dashboardData.todayBookings, todaysClasses, todaysEvents)");
    const panel = read("components/coach/desktop/your-day-panel.tsx");
    expect(panel).toContain('{e.allDay ? "All day" : formatInTimezone(e.startAt, timezone, "time")}');
    expect(panel).toContain('{e.kind === "event" && <span className="font-body text-xs text-rust-ink ml-2">Event</span>}');
  });
});

describe("the phone Calendar and the computer's week view show events at their time", () => {
  it("phone: the coach's own events on the month's days with a dot, in time order among sessions, and in the upcoming list by time", () => {
    const phone = read("components/coach/mobile/coach-phone-schedule.tsx");
    expect(phone.match(/\.from\("calendar_events"\)\.select\(eventCols\)\.eq\("coach_id", userId\)\.neq\("status", "dismissed"\)/g)?.length).toBe(2);
    expect(phone).toContain("].sort((a, b) => a.at.localeCompare(b.at));");
    // each row also opens its day (Nov 21), and the whole list is in time order, their own workouts included (clutter pass, Nov 21)
    expect(phone).toContain("upcomingRows.sort((a, b) => a.at.localeCompare(b.at));");
    expect(phone).toContain('{l.dot && <span aria-hidden="true"');
  });
  it("week view: sessions and events in one list by time, an event with no time last", () => {
    const grid = read("components/coach/desktop/calendar-grid.tsx");
    expect(grid).toContain('...events.map((e) => ({ kind: "event" as const, e, min: e.clock ? parseClockMinutes(e.clock) : Number.MAX_SAFE_INTEGER })),');
    expect(grid).toContain(".sort((x, y) => x.min - y.min)");
  });
});
