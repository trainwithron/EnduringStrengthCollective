import { describe, it, expect } from "vitest";
import { getWeekRange, isWithinRange } from "./week-range";

describe("getWeekRange", () => {
  it("returns Sunday as the start and Saturday as the end for a mid-week date", () => {
    // 2026-09-09 is a Wednesday.
    const { start, end } = getWeekRange(new Date("2026-09-09T12:00:00"));
    expect(start.getDay()).toBe(0);
    expect(end.getDay()).toBe(6);
    expect(start.getDate()).toBe(6);
    expect(end.getDate()).toBe(12);
  });

  it("treats a Sunday reference date as the start of its own week", () => {
    const { start, end } = getWeekRange(new Date("2026-09-06T08:00:00"));
    expect(start.getDate()).toBe(6);
    expect(end.getDate()).toBe(12);
  });

  it("treats a Saturday reference date as the end of its own week", () => {
    const { start, end } = getWeekRange(new Date("2026-09-12T20:00:00"));
    expect(start.getDate()).toBe(6);
    expect(end.getDate()).toBe(12);
  });

  it("crosses a month boundary correctly", () => {
    // 2026-10-01 is a Thursday; that week starts 2026-09-27.
    const { start, end } = getWeekRange(new Date("2026-10-01T12:00:00"));
    expect(start.getMonth()).toBe(8);
    expect(start.getDate()).toBe(27);
    expect(end.getMonth()).toBe(9);
    expect(end.getDate()).toBe(3);
  });
});

describe("isWithinRange", () => {
  it("includes the exact start and end dates", () => {
    const start = new Date("2026-09-06T00:00:00");
    const end = new Date("2026-09-12T00:00:00");
    expect(isWithinRange(new Date("2026-09-06T15:00:00"), start, end)).toBe(true);
    expect(isWithinRange(new Date("2026-09-12T23:59:00"), start, end)).toBe(true);
  });

  it("excludes dates outside the range", () => {
    const start = new Date("2026-09-06T00:00:00");
    const end = new Date("2026-09-12T00:00:00");
    expect(isWithinRange(new Date("2026-09-05T23:00:00"), start, end)).toBe(false);
    expect(isWithinRange(new Date("2026-09-13T00:00:00"), start, end)).toBe(false);
  });
});
