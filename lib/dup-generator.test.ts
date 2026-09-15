import { describe, it, expect } from "vitest";
import { generateDupProgram, DUP_WEEKLY_SCHEME } from "./dup-generator";

describe("generateDupProgram", () => {
  it("produces 3 days x every lift for each requested week", () => {
    const rows = generateDupProgram({
      lifts: [
        { exerciseName: "Back Squat", trainingMax: 300 },
        { exerciseName: "Bench Press", trainingMax: 200 },
      ],
      weeksToGenerate: 2,
    });
    expect(rows).toHaveLength(2 /* weeks */ * 3 /* days */ * 2 /* lifts */);
  });

  it("computes weight as training-max times the day's percentage, rounded to the nearest 5", () => {
    const rows = generateDupProgram({
      lifts: [{ exerciseName: "Back Squat", trainingMax: 303 }],
      weeksToGenerate: 1,
    });
    // Day 1 (Hypertrophy, 70%): 303 * 0.7 = 212.1 -> rounds to 210
    expect(rows[0]).toMatchObject({ weight: 210, sets: 4, reps: "10-12" });
    // Day 2 (Strength, 87.5%): 303 * 0.875 = 265.125 -> rounds to 265
    expect(rows[1]).toMatchObject({ weight: 265, sets: 4, reps: "3-5" });
    // Day 3 (Power/Moderate, 77.5%): 303 * 0.775 = 234.825 -> rounds to 235
    expect(rows[2]).toMatchObject({ weight: 235, sets: 3, reps: "6-8" });
  });

  it("rounds to a custom increment when provided (e.g. kg plates)", () => {
    const rows = generateDupProgram({
      lifts: [{ exerciseName: "Back Squat", trainingMax: 140 }],
      weeksToGenerate: 1,
      roundToNearest: 2.5,
    });
    // 140 * 0.7 = 98 -> nearest 2.5 increment is 97.5
    expect(rows[0].weight).toBe(97.5);
  });

  it("labels each week with its own number so groupIntoWeeks can order them", () => {
    const rows = generateDupProgram({
      lifts: [{ exerciseName: "Deadlift", trainingMax: 400 }],
      weeksToGenerate: 3,
    });
    const weeks = Array.from(new Set(rows.map((r) => r.week)));
    expect(weeks).toEqual(["1", "2", "3"]);
  });

  it("rotates through all 3 DUP schemes within a single week", () => {
    const rows = generateDupProgram({
      lifts: [{ exerciseName: "Overhead Press", trainingMax: 120 }],
      weeksToGenerate: 1,
    });
    expect(rows.map((r) => r.reps)).toEqual(DUP_WEEKLY_SCHEME.map((s) => s.reps));
  });

  it("returns no rows for zero lifts or zero weeks", () => {
    expect(generateDupProgram({ lifts: [], weeksToGenerate: 4 })).toEqual([]);
    expect(generateDupProgram({ lifts: [{ exerciseName: "Back Squat", trainingMax: 300 }], weeksToGenerate: 0 })).toEqual(
      []
    );
  });
});
