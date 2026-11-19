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
