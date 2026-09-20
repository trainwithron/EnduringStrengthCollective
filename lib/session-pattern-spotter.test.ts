import { describe, expect, it } from "vitest";
import {
  detectRpeCreep,
  detectRestTimeCreep,
  detectStrugglePoint,
  detectWeekdayRushing,
} from "./session-pattern-spotter";

describe("detectRpeCreep", () => {
  it("flags a real, sustained drop in average RPE", () => {
    // baseline sessions avg 8, recent sessions avg 6.5 -> delta 1.5
    const result = detectRpeCreep([8, 8, 8, 6.5, 6.5, 6.5], 3, 1.0);
    expect(result).not.toBeNull();
    expect(result!.deltaDown).toBeCloseTo(1.5);
  });

  it("does not flag a stable or rising RPE trend", () => {
    expect(detectRpeCreep([7, 7, 7, 7.5, 7.5, 8], 3, 1.0)).toBeNull();
  });

  it("does not flag with fewer than 2 full rolling windows of data", () => {
    expect(detectRpeCreep([8, 8, 6.5, 6.5], 3, 1.0)).toBeNull();
  });

  it("only uses the most recent windows, ignoring older history", () => {
    // Old sessions were low, but the two most recent windows are stable.
    const result = detectRpeCreep([4, 4, 4, 7, 7, 7, 7, 7, 7], 3, 1.0);
    expect(result).toBeNull();
  });
});

describe("detectRestTimeCreep", () => {
  function samples(target: number, actual: number, count: number) {
    return Array.from({ length: count }, () => ({ targetRestSeconds: target, actualRestSeconds: actual }));
  }

  it("flags real, sustained over-resting", () => {
    const result = detectRestTimeCreep(samples(60, 90, 10), 8, 30);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe("over");
    expect(result!.sampleSize).toBe(10);
  });

  it("flags real, sustained under-resting", () => {
    const result = detectRestTimeCreep(samples(90, 50, 10), 8, 30);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe("under");
  });

  it("does not flag a gap within the threshold", () => {
    expect(detectRestTimeCreep(samples(60, 65, 10), 8, 30)).toBeNull();
  });

  it("returns null below the minimum sample size", () => {
    expect(detectRestTimeCreep(samples(60, 120, 5), 8, 30)).toBeNull();
  });
});

describe("detectStrugglePoint", () => {
  it("flags the one slot with real, sustained low completion", () => {
    const samples = [
      ...Array.from({ length: 6 }, () => ({ slotIndex: 0, setsCompleted: 1, setsPrescribed: 3 })), // warm-up, always cut short
      ...Array.from({ length: 6 }, () => ({ slotIndex: 1, setsCompleted: 3, setsPrescribed: 3 })), // main lift, always full
    ];
    const result = detectStrugglePoint(samples, 5, 70);
    expect(result).not.toBeNull();
    expect(result!.slotIndex).toBe(0);
    expect(result!.avgCompletionPct).toBeCloseTo(33.33, 1);
  });

  it("does not flag a slot completed at or above the threshold", () => {
    const samples = Array.from({ length: 6 }, () => ({ slotIndex: 0, setsCompleted: 3, setsPrescribed: 3 }));
    expect(detectStrugglePoint(samples, 5, 70)).toBeNull();
  });

  it("does not flag a slot with too few real samples", () => {
    const samples = Array.from({ length: 3 }, () => ({ slotIndex: 0, setsCompleted: 0, setsPrescribed: 3 }));
    expect(detectStrugglePoint(samples, 5, 70)).toBeNull();
  });

  it("picks the single worst slot when more than one qualifies", () => {
    const samples = [
      ...Array.from({ length: 5 }, () => ({ slotIndex: 0, setsCompleted: 2, setsPrescribed: 3 })), // 67%
      ...Array.from({ length: 5 }, () => ({ slotIndex: 1, setsCompleted: 1, setsPrescribed: 3 })), // 33%
    ];
    const result = detectStrugglePoint(samples, 5, 70);
    expect(result!.slotIndex).toBe(1);
  });
});

describe("detectWeekdayRushing", () => {
  it("flags a real, sustained rushed weekday", () => {
    const samples = [
      ...Array.from({ length: 4 }, () => ({ weekday: 1, durationSeconds: 3600 })), // Monday, full hour
      ...Array.from({ length: 4 }, () => ({ weekday: 3, durationSeconds: 3600 })), // Wednesday, full hour
      ...Array.from({ length: 3 }, () => ({ weekday: 5, durationSeconds: 1800 })), // Friday, always half
    ];
    const result = detectWeekdayRushing(samples, 3, 25);
    expect(result).not.toBeNull();
    expect(result!.weekday).toBe(5);
  });

  it("does not flag when every weekday is roughly even", () => {
    const samples = [
      ...Array.from({ length: 4 }, () => ({ weekday: 1, durationSeconds: 3600 })),
      ...Array.from({ length: 4 }, () => ({ weekday: 3, durationSeconds: 3500 })),
    ];
    expect(detectWeekdayRushing(samples, 3, 25)).toBeNull();
  });

  it("returns null when only one weekday has any real data", () => {
    const samples = Array.from({ length: 6 }, () => ({ weekday: 1, durationSeconds: 1200 }));
    expect(detectWeekdayRushing(samples, 3, 25)).toBeNull();
  });

  it("requires a real minimum sample count for the flagged weekday", () => {
    const samples = [
      ...Array.from({ length: 5 }, () => ({ weekday: 1, durationSeconds: 3600 })),
      ...Array.from({ length: 2 }, () => ({ weekday: 5, durationSeconds: 600 })), // only 2 samples, below minimum
    ];
    expect(detectWeekdayRushing(samples, 3, 25)).toBeNull();
  });
});
