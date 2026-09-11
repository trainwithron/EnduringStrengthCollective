import { describe, it, expect } from "vitest";
import { zonedTimeToUtc, nowInZone, dateKeyInZone } from "./timezone";

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

describe("nowInZone / dateKeyInZone", () => {
  it("reads the zone's own calendar date, not UTC's — the exact bug this fixes: UTC has already rolled to the next day while it's still evening in US Eastern", () => {
    // 2026-06-16T02:30:00Z is 2026-06-15 22:30 EDT (UTC-4) — still the
    // 15th locally, even though UTC's own date is already the 16th.
    const now = new Date("2026-06-16T02:30:00.000Z");
    expect(dateKeyInZone("America/New_York", now)).toBe("2026-06-15");
    // The naive `new Date().toISOString().slice(0, 10)` this replaces
    // would have read "2026-06-16" here — a full day ahead of the coach's
    // and athlete's real evening.
    expect(now.toISOString().slice(0, 10)).toBe("2026-06-16");
  });

  it("reads the zone's own calendar date when UTC is still on the previous day (zone ahead of UTC)", () => {
    // Tokyo (UTC+9): 2026-06-15T20:00Z is already 2026-06-16 05:00 JST.
    const now = new Date("2026-06-15T20:00:00.000Z");
    expect(dateKeyInZone("Asia/Tokyo", now)).toBe("2026-06-16");
  });

  it("agrees with UTC when the zone is UTC itself", () => {
    const now = new Date("2026-06-15T12:00:00.000Z");
    expect(dateKeyInZone("UTC", now)).toBe("2026-06-15");
  });

  it("resolves the correct weekday across the US spring-forward DST transition", () => {
    // 2026-03-08 02:30 local doesn't exist (clocks skip 2->3am), but an
    // instant shortly after midnight Eastern on the transition date still
    // reads as that same Sunday, both before and after the jump.
    const beforeDst = new Date("2026-03-08T04:00:00.000Z"); // 2026-03-07 23:00 EST
    const afterDst = new Date("2026-03-09T04:00:00.000Z"); // 2026-03-09 00:00 EDT
    expect(dateKeyInZone("America/New_York", beforeDst)).toBe("2026-03-07");
    expect(dateKeyInZone("America/New_York", afterDst)).toBe("2026-03-09");
  });

  it("nowInZone's fields read correctly via the plain (UTC-equivalent) Date accessors a server runs under", () => {
    const now = new Date("2026-06-16T02:30:00.000Z");
    const zoned = nowInZone("America/New_York", now);
    expect(zoned.getUTCFullYear()).toBe(2026);
    expect(zoned.getUTCMonth()).toBe(5); // June, 0-indexed
    expect(zoned.getUTCDate()).toBe(15);
    expect(zoned.getUTCHours()).toBe(22);
    expect(zoned.getUTCMinutes()).toBe(30);
  });
});
