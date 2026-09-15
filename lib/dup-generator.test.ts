import { describe, it, expect } from "vitest";
import { generateDupProgram, generateDupSelfUpdatingProgram, DUP_WEEKLY_SCHEME } from "./dup-generator";
import { resolveProgressionTarget } from "./progressions";

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

// dup_gzclp_build_spec_sept15.md step 4 — DUP Path B
describe("generateDupSelfUpdatingProgram", () => {
  it("never bakes a weight into the shell, not even week 1 (unlike Path A)", () => {
    const { rows } = generateDupSelfUpdatingProgram({
      lifts: [{ exerciseName: "Back Squat", trainingMax: 300 }],
      weeksToGenerate: 2,
    });
    expect(rows.every((r) => r.weight === null)).toBe(true);
  });

  it("produces one wave_from_training_max rule per lift", () => {
    const { progressionRules } = generateDupSelfUpdatingProgram({
      lifts: [
        { exerciseName: "Back Squat", trainingMax: 300 },
        { exerciseName: "Bench Press", trainingMax: 200 },
      ],
      weeksToGenerate: 1,
    });
    expect(progressionRules).toHaveLength(2);
    expect(progressionRules.every((r) => r.model === "wave_from_training_max" && r.tierLabel === "DUP")).toBe(true);
  });

  it("its rule's weightDeltas/repsPattern reproduce Path A's exact percentages when fed through the real progression engine", () => {
    const { progressionRules } = generateDupSelfUpdatingProgram({
      lifts: [{ exerciseName: "Back Squat", trainingMax: 300 }],
      weeksToGenerate: 1,
    });
    const config = progressionRules[0].config;
    // Occurrence 1, referenced against the same training max Path A would use directly.
    const day1 = resolveProgressionTarget({
      model: "wave_from_training_max",
      config,
      occurrenceIndex: 1,
      referenceLog: { weight: 300, reps: 1 },
      previousOccurrenceLog: null,
    });
    // Path A's Day 1 (Hypertrophy, 70%): 300 * 0.7 = 210
    expect(day1).toEqual({ weight: 210, reps: 11 });

    const day2 = resolveProgressionTarget({
      model: "wave_from_training_max",
      config,
      occurrenceIndex: 2,
      referenceLog: { weight: 300, reps: 1 },
      previousOccurrenceLog: null,
    });
    // Path A's Day 2 (Strength, 87.5%): 300 * 0.875 = 262.5
    expect(day2).toEqual({ weight: 262.5, reps: 4 });
  });
});
