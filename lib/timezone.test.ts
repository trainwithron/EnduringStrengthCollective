import { describe, it, expect } from "vitest";
import { zonedTimeToUtc } from "./timezone";

describe("zonedTimeToUtc", () => {
  it("converts a US Eastern wall-clock time (winter, EST = UTC-5)", () => {
    const utc = zonedTimeToUtc("2026-01-15", "09:00", "America/New_York");
    expect(utc.toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("converts a US Eastern wall-clock time (summer, EDT = UTC-4)", () => {
    const utc = zonedTimeToUtc("2026-07-15", "09:00", "America/New_York");
    expect(utc.toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("converts a US Pacific wall-clock time (winter, PST = UTC-8)", () => {
    const utc = zonedTimeToUtc("2026-01-15", "09:00", "America/Los_Angeles");
    expect(utc.toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("round-trips UTC itself with no offset", () => {
    const utc = zonedTimeToUtc("2026-01-15", "09:00", "UTC");
    expect(utc.toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("handles a timezone ahead of UTC, crossing the UTC calendar date", () => {
    // Tokyo is UTC+9 — 9:00 AM local on the 15th is still the 14th in UTC.
    const utc = zonedTimeToUtc("2026-01-15", "09:00", "Asia/Tokyo");
    expect(utc.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("correctly shifts across the US spring-forward DST transition", () => {
    // 2026-03-08 is the US DST start date — before it, EST (UTC-5); the
    // very next day, EDT (UTC-4). Same wall-clock hour, different offset.
    const beforeDst = zonedTimeToUtc("2026-03-07", "09:00", "America/New_York");
    const afterDst = zonedTimeToUtc("2026-03-09", "09:00", "America/New_York");
    expect(beforeDst.toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(afterDst.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });
});
