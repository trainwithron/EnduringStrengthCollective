import { describe, it, expect } from "vitest";
import { computeRemainingSeconds, formatMMSS } from "./rest-timer-math";

describe("computeRemainingSeconds", () => {
  it("counts down correctly as time elapses", () => {
    const startedAtMs = 1_000_000;
    expect(computeRemainingSeconds(startedAtMs, 90, startedAtMs)).toBe(90);
    expect(computeRemainingSeconds(startedAtMs, 90, startedAtMs + 30_000)).toBe(60);
  });

  it("clamps at 0 once the duration has fully elapsed", () => {
    const startedAtMs = 1_000_000;
    expect(computeRemainingSeconds(startedAtMs, 90, startedAtMs + 200_000)).toBe(0);
  });

  it("never goes negative even far past expiry", () => {
    const startedAtMs = 1_000_000;
    expect(computeRemainingSeconds(startedAtMs, 60, startedAtMs + 10_000_000)).toBe(0);
  });
});

describe("formatMMSS", () => {
  it("formats seconds as M:SS", () => {
    expect(formatMMSS(90)).toBe("1:30");
    expect(formatMMSS(65)).toBe("1:05");
    expect(formatMMSS(5)).toBe("0:05");
  });

  it("handles minutes past 60 without a special-case format", () => {
    expect(formatMMSS(3725)).toBe("62:05");
  });

  it("clamps negative input to 0:00", () => {
    expect(formatMMSS(-10)).toBe("0:00");
  });
});
