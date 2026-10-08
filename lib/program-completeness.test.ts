import { describe, it, expect } from "vitest";
import { looksUnfinished, programDayShape } from "./program-completeness";

describe("looks unfinished", () => {
  it("not marked: no days, or every day has exercises, or only a few days are empty", () => {
    expect(looksUnfinished([])).toBe(false);
    expect(looksUnfinished([4, 5, 3, 6])).toBe(false);
    expect(looksUnfinished([4, 0, 5, 6])).toBe(false);
  });
  it("marked: half or more of the days are empty", () => {
    expect(looksUnfinished([0, 0, 5, 4])).toBe(true);
    expect(looksUnfinished([0, 0, 0, 0])).toBe(true);
    expect(looksUnfinished([0])).toBe(true);
  });
  it("reads the days as the programs pages fetch them", () => {
    expect(programDayShape(null)).toEqual({ workoutCount: 0, looksUnfinished: false });
    expect(programDayShape([{ group_workout_exercises: [{ count: 0 }] }, { group_workout_exercises: [{ count: 3 }] }, { group_workout_exercises: [{ count: 3 }] }])).toEqual({ workoutCount: 3, looksUnfinished: false });
    expect(programDayShape([{ group_workout_exercises: [{ count: 0 }] }, { group_workout_exercises: [] }, { group_workout_exercises: [{ count: 3 }] }]).looksUnfinished).toBe(true);
  });
});
