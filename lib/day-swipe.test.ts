import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { daySwipeHrefs, swipeDirection } from "./day-swipe";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("swiping a calendar day on a phone (Ron, Nov 2)", () => {
  it("left is the next day, right is the previous day; a scroll or a short or slow drag is not a swipe", () => {
    expect(swipeDirection(-120, 10, 250)).toBe("next");
    expect(swipeDirection(120, -10, 250)).toBe("prev");
    expect(swipeDirection(-40, 0, 200)).toBeNull();
    expect(swipeDirection(-100, 90, 250)).toBeNull();
    expect(swipeDirection(-150, 0, 1500)).toBeNull();
  });

  it("goes one day either side, across a month or year end, keeping the picked client or the session being rescheduled", () => {
    expect(daySwipeHrefs("g1", "2026-11-30", {})).toEqual({ prev: "/groups/g1/calendar/2026-11-29", next: "/groups/g1/calendar/2026-12-01" });
    expect(daySwipeHrefs("g1", "2027-01-01", { client: "c1", reschedule: undefined }).prev).toBe("/groups/g1/calendar/2026-12-31?client=c1");
    expect(daySwipeHrefs("g1", "2026-11-02", { reschedule: "b1" }).next).toBe("/groups/g1/calendar/2026-11-03?reschedule=b1");
  });

  it("is on the day page for both a coach and a client, and touch only", () => {
    const page = read("app/(coach)/groups/[groupId]/calendar/[date]/page.tsx");
    expect(page.match(/<DaySwipeNav prevHref=\{swipe\.prev\} nextHref=\{swipe\.next\} \/>/g)).toHaveLength(2);
    const nav = read("components/shared/day-swipe-nav.tsx");
    expect(nav).toContain('document.addEventListener("touchstart", down, { passive: true });');
    expect(nav).toContain("router.replace(");
  });
});
