import { describe, expect, it } from "vitest";
import { isUnder13 } from "./coppa";

describe("isUnder13", () => {
  it("is true the day before the 13th birthday", () => {
    expect(isUnder13("2013-06-15", new Date("2026-06-14T12:00:00"))).toBe(true);
  });

  it("is false on the 13th birthday itself", () => {
    expect(isUnder13("2013-06-15", new Date("2026-06-15T00:00:00"))).toBe(false);
  });

  it("is false the day after the 13th birthday", () => {
    expect(isUnder13("2013-06-15", new Date("2026-06-16T12:00:00"))).toBe(false);
  });

  it("is true for a clearly-under-13 birthdate", () => {
    expect(isUnder13("2018-01-01", new Date("2026-09-11T12:00:00"))).toBe(true);
  });

  it("is false for a clearly-adult birthdate", () => {
    expect(isUnder13("1985-01-01", new Date("2026-09-11T12:00:00"))).toBe(false);
  });

  it("handles a leap-year Feb 29 birthday correctly", () => {
    // 2016-02-29 -> 13th "birthday" lands on 2029-03-01 (JS Date rolls
    // Feb 29 + 13 years forward past a non-leap Feb 28/29).
    expect(isUnder13("2016-02-29", new Date("2029-02-28T12:00:00"))).toBe(true);
    expect(isUnder13("2016-02-29", new Date("2029-03-02T12:00:00"))).toBe(false);
  });
});
