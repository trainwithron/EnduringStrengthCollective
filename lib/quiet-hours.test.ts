import { describe, it, expect } from "vitest";
import { isWithinQuietHours } from "./quiet-hours";

function atUtcTime(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 0, 1, hour, minute, 0));
}

describe("isWithinQuietHours", () => {
  it("returns false when no quiet hours are configured", () => {
    expect(isWithinQuietHours(atUtcTime(23, 0), null, null)).toBe(false);
  });

  it("returns false for a zero-width window (disabled)", () => {
    expect(isWithinQuietHours(atUtcTime(12, 0), "09:00", "09:00")).toBe(false);
  });

  it("flags a time inside a same-day window", () => {
    expect(isWithinQuietHours(atUtcTime(13, 0), "12:00", "14:00")).toBe(true);
  });

  it("does not flag a time outside a same-day window", () => {
    expect(isWithinQuietHours(atUtcTime(15, 0), "12:00", "14:00")).toBe(false);
  });

  it("includes the exact start boundary of a same-day window", () => {
    expect(isWithinQuietHours(atUtcTime(12, 0), "12:00", "14:00")).toBe(true);
  });

  it("excludes the exact end boundary of a same-day window", () => {
    expect(isWithinQuietHours(atUtcTime(14, 0), "12:00", "14:00")).toBe(false);
  });

  it("flags a time inside an overnight window, after midnight", () => {
    expect(isWithinQuietHours(atUtcTime(2, 0), "21:00", "7:00")).toBe(true);
  });

  it("flags a time inside an overnight window, before midnight", () => {
    expect(isWithinQuietHours(atUtcTime(22, 0), "21:00", "7:00")).toBe(true);
  });

  it("does not flag a daytime hour outside an overnight window", () => {
    expect(isWithinQuietHours(atUtcTime(12, 0), "21:00", "7:00")).toBe(false);
  });

  it("excludes the exact end boundary of an overnight window", () => {
    expect(isWithinQuietHours(atUtcTime(7, 0), "21:00", "7:00")).toBe(false);
  });
});
