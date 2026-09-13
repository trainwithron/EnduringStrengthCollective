import { describe, expect, it } from "vitest";
import { hasEstablishedBaseline } from "./coach-briefing-baseline";

describe("hasEstablishedBaseline", () => {
  it("is false with no activity at all", () => {
    expect(hasEstablishedBaseline(null, new Date(2026, 0, 28))).toBe(false);
  });

  it("is false just under the 28-day window", () => {
    const first = new Date(2026, 0, 1);
    const now = new Date(2026, 0, 1 + 27);
    expect(hasEstablishedBaseline(first, now)).toBe(false);
  });

  it("is true exactly at the 28-day window", () => {
    const first = new Date(2026, 0, 1);
    const now = new Date(2026, 0, 1 + 28);
    expect(hasEstablishedBaseline(first, now)).toBe(true);
  });

  it("respects a custom window size", () => {
    const first = new Date(2026, 0, 1);
    const now = new Date(2026, 0, 1 + 10);
    expect(hasEstablishedBaseline(first, now, 7)).toBe(true);
    expect(hasEstablishedBaseline(first, now, 14)).toBe(false);
  });
});
