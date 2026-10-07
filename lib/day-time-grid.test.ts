import { describe, it, expect } from "vitest";
import { assignLanes, clockLabel, clockLabel12, gridRange, minuteFromOffset, minutesOfDayInZone, offsetFromMinute, parseClockMinutes, placementProblem, snapMinutes } from "./day-time-grid";

describe("clock helpers", () => {
  it("reads and writes clock times", () => {
    expect(parseClockMinutes("06:30:00")).toBe(390);
    expect(parseClockMinutes("17:05")).toBe(1025);
    expect(clockLabel(390)).toBe("06:30");
    expect(clockLabel12(390)).toBe("6:30 AM");
    expect(clockLabel12(12 * 60)).toBe("12:00 PM");
    expect(clockLabel12(0)).toBe("12:00 AM");
  });
  it("puts an instant on the coach's own clock, not the runtime's", () => {
    // 13:00 UTC is 6:00 AM in Los Angeles in summer and 9:00 AM in New York.
    const when = new Date("2026-07-10T13:00:00Z");
    expect(minutesOfDayInZone(when, "America/Los_Angeles")).toBe(6 * 60);
    expect(minutesOfDayInZone(when, "America/New_York")).toBe(9 * 60);
    expect(minutesOfDayInZone(new Date("2026-07-10T07:05:00Z"), "UTC")).toBe(7 * 60 + 5);
  });
});

describe("snapping and the visible range", () => {
  it("snaps to 5 or 15 minutes", () => {
    expect(snapMinutes(367, 5)).toBe(365);
    expect(snapMinutes(368, 5)).toBe(370);
    expect(snapMinutes(367, 15)).toBe(360);
    expect(snapMinutes(368, 15)).toBe(375);
  });
  it("shows at least the working day and widens to hold everything, in whole hours", () => {
    expect(gridRange([])).toEqual({ startMin: 360, endMin: 1200 });
    expect(gridRange([{ startMin: 5 * 60 + 30, endMin: 21 * 60 + 10 }])).toEqual({ startMin: 300, endMin: 1320 });
    expect(gridRange([{ startMin: 0, endMin: 24 * 60 }])).toEqual({ startMin: 0, endMin: 1440 });
    // An empty or backwards span changes nothing.
    expect(gridRange([{ startMin: 100, endMin: 100 }])).toEqual({ startMin: 360, endMin: 1200 });
  });
  it("maps a pointer position to a snapped start that still ends inside the day", () => {
    const range = { startMin: 360, endMin: 1200 };
    expect(minuteFromOffset(0, range, 15, 60)).toBe(360);
    expect(minuteFromOffset(offsetFromMinute(480, range), range, 15, 60)).toBe(480);
    expect(minuteFromOffset(offsetFromMinute(487, range), range, 5, 60)).toBe(485);
    // Dragged below the last hour: the 60-minute session is held so it ends at the end of the range.
    expect(minuteFromOffset(99999, range, 15, 60)).toBe(1140);
    expect(minuteFromOffset(-50, range, 15, 60)).toBe(360);
  });
});

describe("overlapping sessions", () => {
  it("sit side by side, with shared widths inside one overlap and a fresh start after it", () => {
    const placed = assignLanes([
      { startMin: 480, endMin: 540, id: "a" },
      { startMin: 500, endMin: 560, id: "b" },
      { startMin: 600, endMin: 660, id: "c" },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.item.id, p]));
    expect([by.a.lane, by.b.lane]).toEqual([0, 1]);
    expect([by.a.lanes, by.b.lanes]).toEqual([2, 2]);
    expect([by.c.lane, by.c.lanes]).toEqual([0, 1]);
  });
  it("reuses a lane once it is free", () => {
    const placed = assignLanes([
      { startMin: 480, endMin: 520 },
      { startMin: 490, endMin: 700 },
      { startMin: 530, endMin: 560 },
    ]);
    expect(placed.map((p) => p.lane)).toEqual([0, 1, 0]);
    expect(placed.every((p) => p.lanes === 2)).toBe(true);
  });
  it("handles none", () => {
    expect(assignLanes([])).toEqual([]);
  });
});

describe("where a session sits against the day", () => {
  const base = {
    sessions: [{ startMin: 540, endMin: 600 }],
    windows: [{ startMin: 360, endMin: 1020 }],
    blocked: [{ startMin: 720, endMin: 780 }],
    bufferMin: 5,
  };
  it("is fine inside open hours with room around it", () => {
    expect(placementProblem({ ...base, startMin: 660, endMin: 720 - 5 })).toBeNull();
    expect(placementProblem({ ...base, startMin: 800, endMin: 860 })).toBeNull();
  });
  it("is taken when it overlaps a session, buffer when it is only within the gap", () => {
    expect(placementProblem({ ...base, startMin: 570, endMin: 630 })).toBe("taken");
    expect(placementProblem({ ...base, startMin: 603, endMin: 650 })).toBe("buffer");
    expect(placementProblem({ ...base, startMin: 605, endMin: 650 })).toBeNull();
    expect(placementProblem({ ...base, bufferMin: 0, startMin: 600, endMin: 650 })).toBeNull();
  });
  it("is outside when it leaves the hours or touches time off, and a day with no hours is outside", () => {
    expect(placementProblem({ ...base, startMin: 1000, endMin: 1060 })).toBe("outside");
    expect(placementProblem({ ...base, startMin: 700, endMin: 740 })).toBe("outside");
    expect(placementProblem({ ...base, windows: [], startMin: 800, endMin: 860 })).toBe("outside");
  });
});
