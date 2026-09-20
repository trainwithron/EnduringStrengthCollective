import { describe, expect, it } from "vitest";
import { findMatchingBookingId } from "./booking-session-link";

describe("findMatchingBookingId", () => {
  it("matches a booking starting near the session start", () => {
    const startedAt = new Date("2026-09-20T17:05:00Z");
    const bookings = [{ id: "b1", startAt: new Date("2026-09-20T17:00:00Z") }];
    expect(findMatchingBookingId(bookings, startedAt)).toBe("b1");
  });

  it("picks the closest booking when more than one is within tolerance", () => {
    const startedAt = new Date("2026-09-20T17:00:00Z");
    const bookings = [
      { id: "far", startAt: new Date("2026-09-20T15:30:00Z") },
      { id: "near", startAt: new Date("2026-09-20T16:50:00Z") },
    ];
    expect(findMatchingBookingId(bookings, startedAt)).toBe("near");
  });

  it("returns null when nothing is within tolerance", () => {
    const startedAt = new Date("2026-09-20T17:00:00Z");
    const bookings = [{ id: "b1", startAt: new Date("2026-09-20T09:00:00Z") }];
    expect(findMatchingBookingId(bookings, startedAt)).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(findMatchingBookingId([], new Date())).toBeNull();
  });

  it("respects a custom tolerance window", () => {
    const startedAt = new Date("2026-09-20T17:00:00Z");
    const bookings = [{ id: "b1", startAt: new Date("2026-09-20T17:31:00Z") }];
    expect(findMatchingBookingId(bookings, startedAt, 30)).toBeNull();
    expect(findMatchingBookingId(bookings, startedAt, 45)).toBe("b1");
  });

  it("matches exactly at the tolerance boundary", () => {
    const startedAt = new Date("2026-09-20T17:00:00Z");
    const bookings = [{ id: "b1", startAt: new Date("2026-09-20T19:00:00Z") }];
    expect(findMatchingBookingId(bookings, startedAt, 120)).toBe("b1");
  });
});
