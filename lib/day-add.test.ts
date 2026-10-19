import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addTimeChoices, endFrom, minutesBetween, overlapWarning, parseTimeInput, shiftTime, timeOptions15 } from "@/lib/day-add";
import { minutesToTimeInput, snapTapToMinutes } from "@/components/coach/desktop/day-hour-grid";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("tap a time on the coach's day, then add something there", () => {
  it("a tap lands on the nearest 5 minutes of that spot on the grid", () => {
    expect(snapTapToMinutes(0, 360)).toBe(360);
    expect(snapTapToMinutes(263, 360)).toBe(630);
    expect(snapTapToMinutes(255, 360)).toBe(615);
    expect(minutesToTimeInput(630)).toBe("10:30");
  });
  it("any typed minute is a time (10:22), a bad one is not", () => {
    expect(parseTimeInput("10:22")).toEqual({ hour: 10, minute: 22 });
    expect(parseTimeInput("25:00")).toBeNull();
    expect(parseTimeInput("")).toBeNull();
  });
  it("the nudge moves five minutes and stays inside the day", () => {
    expect(shiftTime("10:22", 5)).toBe("10:27");
    expect(shiftTime("00:02", -5)).toBe("00:00");
  });
  it("the Start and End dropdowns list every 15 minutes, any typed minute still works, and the end follows the start", () => {
    const opts = timeOptions15();
    expect(opts).toHaveLength(96);
    expect(opts.slice(0, 5)).toEqual(["00:00", "00:15", "00:30", "00:45", "01:00"]);
    expect(minutesBetween("10:22", "10:52")).toBe(30);
    expect(minutesBetween("10:30", "10:00")).toBeNull();
    expect(endFrom("10:22", 30)).toBe("10:52");
    const sheet = read("components/coach/desktop/day-calendar.tsx");
    expect(sheet).toContain('list="day-add-times"');
  });
  it("the sheet offers a client session, an event and a block", () => {
    expect(addTimeChoices().map((c) => c.label)).toEqual(["Client session", "Event", "Block time"]);
  });
  it("overlaps and out-of-hours are warned about, never blocked", () => {
    const busy = [{ startMs: 1000, endMs: 2000 }];
    expect(overlapWarning(1500, 2500, busy, [{ startMs: 0, endMs: 9999 }], "session")).toBe("This overlaps another session.");
    expect(overlapWarning(5000, 6000, busy, [{ startMs: 0, endMs: 3000 }], "session")).toContain("outside your open hours");
    expect(overlapWarning(5000, 6000, busy, [{ startMs: 0, endMs: 3000 }], "block")).toBeNull();
  });
  it("the sheet books through the same book_session call as the open slots and never disables on an overlap", () => {
    const sheet = read("components/coach/desktop/day-calendar.tsx");
    expect(sheet).toContain('rpc("book_session"');
    expect(sheet).toContain("notifyBookingConfirmed(");
    expect(sheet).not.toMatch(/disabled=\{[^}]*warning/);
  });
  it("the day page uses it, for any coach (desktop and phone share the page)", () => {
    const page = read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx");
    expect(page).toContain("<DayCalendar");
    // said once, right above the grid, not also under the title
    expect(page).not.toContain("Tap a time on the day to add a session, an event or time off.");
    expect(read("components/coach/desktop/day-calendar.tsx").match(/Tap a time to add a session, an event or time off./g)?.length).toBe(1);
  });
  it("a new availability window defaults to a slot every 30 minutes", () => {
    expect(read("components/coach/availability-manager.tsx")).toContain('useState("30")');
    expect(read("components/coach/desktop/availability-manager-desktop.tsx")).toContain('useState("30")');
  });
});
