import { describe, expect, it } from "vitest";
import { detectMatchedLoadTrend, type ExerciseSessionPoint } from "./matched-load-trend";

function point(date: string, weight: number, rpe: number): ExerciseSessionPoint {
  return { sessionDate: date, topWeight: weight, topSetRpe: rpe };
}

describe("detectMatchedLoadTrend — not enough history", () => {
  it("returns null with fewer than 3 sessions", () => {
    const points = [point("2026-01-01", 225, 7), point("2026-01-03", 225, 8)];
    expect(detectMatchedLoadTrend("Back Squat", points)).toBeNull();
  });
});

describe("detectMatchedLoadTrend — fatigue direction", () => {
  it("detects a 3-session streak at flat weight with rising RPE", () => {
    const points = [point("2026-01-01", 225, 7), point("2026-01-03", 225, 7.5), point("2026-01-05", 225, 8.5)];
    const result = detectMatchedLoadTrend("Back Squat", points);
    expect(result).toEqual({
      direction: "fatigue",
      exerciseName: "Back Squat",
      sessionCount: 3,
      rpeStart: 7,
      rpeEnd: 8.5,
      weightStart: 225,
      weightEnd: 225,
    });
  });

  it("still counts as fatigue when weight actually drops session over session (same-or-lower qualifies)", () => {
    const points = [point("2026-01-01", 225, 7), point("2026-01-03", 215, 8), point("2026-01-05", 205, 9)];
    const result = detectMatchedLoadTrend("Back Squat", points);
    expect(result?.direction).toBe("fatigue");
    expect(result?.sessionCount).toBe(3);
  });

  it("extends the streak beyond 3 sessions when the pattern keeps holding", () => {
    const points = [
      point("2026-01-01", 225, 6),
      point("2026-01-03", 225, 7),
      point("2026-01-05", 225, 7.5),
      point("2026-01-07", 225, 8),
      point("2026-01-09", 220, 8.5),
    ];
    const result = detectMatchedLoadTrend("Back Squat", points);
    expect(result?.direction).toBe("fatigue");
    expect(result?.sessionCount).toBe(5);
  });

  it("truncates to only the trailing streak when an earlier session breaks the pattern", () => {
    // Session 2's weight (185) is genuinely lower than session 3's (225) —
    // walking backward from the most recent session, that's where the
    // fatigue pattern (matched-or-lower weight going forward in time)
    // actually breaks. Sessions 3-5 form their own valid, self-contained
    // 3-session fatigue streak on their own.
    const points = [
      point("2026-01-01", 185, 9),
      point("2026-01-03", 185, 5), // breaks the streak here (RPE drops going forward)
      point("2026-01-05", 225, 6),
      point("2026-01-07", 225, 7),
      point("2026-01-09", 225, 8),
    ];
    const result = detectMatchedLoadTrend("Back Squat", points);
    expect(result?.direction).toBe("fatigue");
    expect(result?.sessionCount).toBe(3);
    expect(result?.rpeStart).toBe(6);
    expect(result?.rpeEnd).toBe(8);
  });
});

describe("detectMatchedLoadTrend — strength_gain (celebration) direction", () => {
  it("detects RPE falling at flat weight across 3 sessions", () => {
    const points = [point("2026-01-01", 225, 9), point("2026-01-03", 225, 8), point("2026-01-05", 225, 7)];
    const result = detectMatchedLoadTrend("Bench Press", points);
    expect(result).toEqual({
      direction: "strength_gain",
      exerciseName: "Bench Press",
      sessionCount: 3,
      rpeStart: 9,
      rpeEnd: 7,
      weightStart: 225,
      weightEnd: 225,
    });
  });

  it("still counts as strength_gain when weight actually rises session over session (same-or-higher qualifies)", () => {
    const points = [point("2026-01-01", 185, 9), point("2026-01-03", 195, 8), point("2026-01-05", 205, 7)];
    const result = detectMatchedLoadTrend("Bench Press", points);
    expect(result?.direction).toBe("strength_gain");
  });
});

describe("detectMatchedLoadTrend — no real trend", () => {
  it("returns null when weight and RPE are both perfectly flat (no net change)", () => {
    const points = [point("2026-01-01", 225, 8), point("2026-01-03", 225, 8), point("2026-01-05", 225, 8)];
    expect(detectMatchedLoadTrend("Deadlift", points)).toBeNull();
  });

  it("returns null when weight rises alongside RPE (a heavier top set fully explains the higher effort)", () => {
    const points = [point("2026-01-01", 225, 7), point("2026-01-03", 245, 8), point("2026-01-05", 265, 9)];
    expect(detectMatchedLoadTrend("Deadlift", points)).toBeNull();
  });

  it("returns null when the pattern only holds for 2 sessions, not 3", () => {
    const points = [point("2026-01-01", 225, 6), point("2026-01-03", 225, 9), point("2026-01-05", 225, 7)];
    expect(detectMatchedLoadTrend("Deadlift", points)).toBeNull();
  });
});
