import { describe, it, expect } from "vitest";
import {
  computeExpectedMinimumSeconds,
  isSuspiciouslyFast,
  computeIntegrityLevel,
} from "./session-integrity";

describe("computeExpectedMinimumSeconds", () => {
  it("scales with set count and rest", () => {
    const sixSets = Array.from({ length: 6 }, () => ({ restSeconds: 90 }));
    // 6 * (20 + 90*0.5) = 6 * 65 = 390
    expect(computeExpectedMinimumSeconds(sixSets)).toBe(390);
  });

  it("defaults to a 60s rest assumption when a set has none prescribed", () => {
    expect(computeExpectedMinimumSeconds([{ restSeconds: null }])).toBe(20 + 60 * 0.5);
  });
});

describe("isSuspiciouslyFast", () => {
  it("flags a real example: many sets logged in ~5 minutes", () => {
    // Ron's own confirmed real case — a many-set session in ~5 min.
    const expected = computeExpectedMinimumSeconds(
      Array.from({ length: 12 }, () => ({ restSeconds: 90 }))
    );
    expect(isSuspiciouslyFast(300, expected)).toBe(true);
  });

  it("does not flag a genuinely fast but plausible session", () => {
    const expected = computeExpectedMinimumSeconds([{ restSeconds: 60 }, { restSeconds: 60 }]);
    expect(isSuspiciouslyFast(expected, expected)).toBe(false);
    expect(isSuspiciouslyFast(expected * 0.9, expected)).toBe(false);
  });

  it("never flags when there's nothing prescribed to compare against", () => {
    expect(isSuspiciouslyFast(10, 0)).toBe(false);
  });
});

describe("computeIntegrityLevel", () => {
  function session(id: string, fast: boolean): { sessionId: string; actualSeconds: number; expectedMinimumSeconds: number; completedAt: string } {
    return {
      sessionId: id,
      actualSeconds: fast ? 100 : 1000,
      expectedMinimumSeconds: 600,
      completedAt: "2026-01-01",
    };
  }

  it("reports 'none' when nothing is flagged", () => {
    const result = computeIntegrityLevel([session("a", false), session("b", false)]);
    expect(result.level).toBe("none");
    expect(result.flaggedCount).toBe(0);
  });

  it("reports 'single' for one flagged session — a quiet signal, not an escalation", () => {
    const result = computeIntegrityLevel([session("a", true), session("b", false)]);
    expect(result.level).toBe("single");
    expect(result.flaggedCount).toBe(1);
  });

  it("escalates to 'pattern' once flagged sessions cross the repeat threshold", () => {
    const result = computeIntegrityLevel([
      session("a", true),
      session("b", true),
      session("c", true),
      session("d", false),
    ]);
    expect(result.level).toBe("pattern");
    expect(result.flaggedCount).toBe(3);
    expect(result.flaggedSessions.map((s) => s.sessionId)).toEqual(["a", "b", "c"]);
  });
});
