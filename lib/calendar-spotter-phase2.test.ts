import { describe, expect, it } from "vitest";
import {
  detectRecurringScheduleGaps,
  detectUnevenTrainerLoad,
  detectBookedVsActualMismatch,
} from "./calendar-spotter-phase2";

describe("detectRecurringScheduleGaps", () => {
  const window = { weekday: 2, startTime: "14:00", endTime: "16:00" }; // Tuesday 2-4pm

  it("flags a window unbooked for every occurrence in the lookback window", () => {
    const asOf = new Date("2026-09-20T00:00:00"); // a Sunday
    const results = detectRecurringScheduleGaps([window], [], asOf, 6);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ weekday: 2, startTime: "14:00", endTime: "16:00", weeksChecked: 6 });
  });

  it("does not flag a window that was booked at least once", () => {
    const asOf = new Date("2026-09-20T00:00:00");
    // The Tuesday one week back (2026-09-15) is booked at 3pm.
    const bookings = [{ startAt: new Date("2026-09-15T15:00:00") }];
    const results = detectRecurringScheduleGaps([window], bookings, asOf, 6);
    expect(results).toHaveLength(0);
  });

  it("does not flag when a booking exists outside the window's own hours on that day", () => {
    const asOf = new Date("2026-09-20T00:00:00");
    // Same Tuesday, but at 6pm — outside the 2-4pm window.
    const bookings = [{ startAt: new Date("2026-09-15T18:00:00") }];
    const results = detectRecurringScheduleGaps([window], bookings, asOf, 6);
    expect(results).toHaveLength(1);
  });

  it("returns no results for an empty windows list", () => {
    expect(detectRecurringScheduleGaps([], [], new Date(), 6)).toEqual([]);
  });
});

describe("detectUnevenTrainerLoad", () => {
  it("flags a real imbalance at or above the ratio threshold", () => {
    const loads = [
      { trainerId: "a", trainerName: "Coach A", bookedMinutes: 1200 },
      { trainerId: "b", trainerName: "Coach B", bookedMinutes: 500 },
    ];
    const result = detectUnevenTrainerLoad(loads, 2);
    expect(result).toMatchObject({ overloadedTrainerId: "a", underloadedTrainerId: "b" });
    expect(result!.ratio).toBeCloseTo(2.4);
  });

  it("does not flag a roughly even load", () => {
    const loads = [
      { trainerId: "a", trainerName: "Coach A", bookedMinutes: 900 },
      { trainerId: "b", trainerName: "Coach B", bookedMinutes: 850 },
    ];
    expect(detectUnevenTrainerLoad(loads)).toBeNull();
  });

  it("does not flag when only one trainer has any real bookings", () => {
    const loads = [
      { trainerId: "a", trainerName: "Coach A", bookedMinutes: 600 },
      { trainerId: "b", trainerName: "Coach B", bookedMinutes: 0 },
    ];
    expect(detectUnevenTrainerLoad(loads)).toBeNull();
  });

  it("does not flag a solo coach with no one to compare against", () => {
    expect(detectUnevenTrainerLoad([{ trainerId: "a", trainerName: "Coach A", bookedMinutes: 1000 }])).toBeNull();
  });

  it("flags exactly at the threshold ratio", () => {
    const loads = [
      { trainerId: "a", trainerName: "Coach A", bookedMinutes: 200 },
      { trainerId: "b", trainerName: "Coach B", bookedMinutes: 100 },
    ];
    expect(detectUnevenTrainerLoad(loads, 2)).not.toBeNull();
  });
});

describe("detectBookedVsActualMismatch", () => {
  function pairs(bookedMinutes: number, actualMinutes: number, count: number) {
    return Array.from({ length: count }, () => ({ bookedMinutes, actualMinutes }));
  }

  it("returns null below the minimum sample size", () => {
    expect(detectBookedVsActualMismatch(pairs(60, 40, 9), 10)).toBeNull();
  });

  it("flags a real, sustained 'shorter than booked' pattern", () => {
    const result = detectBookedVsActualMismatch(pairs(60, 40, 15), 10, 20);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe("shorter");
    expect(result!.sampleSize).toBe(15);
    expect(result!.avgDeltaPct).toBeCloseTo(33.33, 1);
  });

  it("flags a real, sustained 'longer than booked' pattern", () => {
    const result = detectBookedVsActualMismatch(pairs(30, 45, 12), 10, 20);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe("longer");
  });

  it("does not flag a gap within the threshold", () => {
    expect(detectBookedVsActualMismatch(pairs(60, 55, 20), 10, 20)).toBeNull();
  });

  it("handles an empty pair list without throwing", () => {
    expect(detectBookedVsActualMismatch([], 10)).toBeNull();
  });
});
