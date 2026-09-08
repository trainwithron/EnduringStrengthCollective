import { describe, it, expect } from "vitest";
import { detectColumns, parseImportRows, groupIntoWeeks } from "./workout-import-parser";

describe("detectColumns", () => {
  it("auto-detects a typical export's headers", () => {
    const headers = ["Day", "Exercise Name", "Sets", "Reps", "Weight (lbs)", "RPE", "Rest"];
    const mapping = detectColumns(headers);
    expect(mapping).toEqual({ day: 0, exercise: 1, sets: 2, reps: 3, weight: 4, rpe: 5, rest: 6 });
  });

  it("leaves a column unmapped when nothing matches", () => {
    const headers = ["Movement", "Notes"];
    const mapping = detectColumns(headers);
    expect(mapping.exercise).toBe(0);
    expect(mapping.day).toBeUndefined();
    expect(mapping.sets).toBeUndefined();
  });

  it("handles a real-world export with Week + a combined Prescription column", () => {
    const headers = ["Week", "Day", "Focus", "Exercise #", "Exercise", "Sets", "Prescription"];
    const mapping = detectColumns(headers);
    expect(mapping.week).toBe(0);
    expect(mapping.day).toBe(1);
    // "Exercise #" contains "exercise" too, but the exact-match "Exercise"
    // column must win, not the numbering column next to it.
    expect(mapping.exercise).toBe(4);
    expect(mapping.sets).toBe(5);
    expect(mapping.prescription).toBe(6);
  });
});

describe("parseImportRows", () => {
  const mapping = { week: 0, day: 1, exercise: 2, sets: 3, reps: 4, weight: 5, rpe: 6 };

  it("parses a well-formed row", () => {
    const rows = parseImportRows(
      [["Week 1", "Day 1", "Back Squat", "3", "5", "225 lbs", "8"]],
      mapping
    );
    expect(rows).toEqual([
      {
        week: "Week 1",
        day: "Day 1",
        exerciseName: "Back Squat",
        sets: 3,
        reps: "5",
        weight: 225,
        rpe: 8,
        rest: null,
        timeSeconds: null,
      },
    ]);
  });

  it("skips rows with no exercise name", () => {
    const rows = parseImportRows([["Week 1", "Day 1", "", "3", "5", "225", "8"]], mapping);
    expect(rows).toHaveLength(0);
  });

  it("defaults sets to 1, day to 'Day 1', and week to 'Week 1' when those columns are missing", () => {
    const rows = parseImportRows([["Push Up"]], { exercise: 0 });
    expect(rows).toEqual([
      {
        week: "Week 1",
        day: "Day 1",
        exerciseName: "Push Up",
        sets: 1,
        reps: null,
        weight: null,
        rpe: null,
        rest: null,
        timeSeconds: null,
      },
    ]);
  });

  it("falls back to a combined Prescription column for reps and hold time", () => {
    const rows = parseImportRows(
      [["Week 1", "Day 1", "Hollow Hold (Dish)", "3", "Reps: 1 x 3, Time (sec): 30 x 3"]],
      { week: 0, day: 1, exercise: 2, sets: 3, prescription: 4 }
    );
    expect(rows[0].reps).toBe("1");
    expect(rows[0].timeSeconds).toBe(30);
  });
});

describe("groupIntoWeeks", () => {
  it("groups rows by week then day, preserving first-seen order at both levels", () => {
    const weeks = groupIntoWeeks([
      { week: "Week 1", day: "Day 2", exerciseName: "Row", sets: 3, reps: "10", weight: null, rpe: null, rest: null, timeSeconds: null },
      { week: "Week 1", day: "Day 1", exerciseName: "Squat", sets: 3, reps: "5", weight: 200, rpe: null, rest: null, timeSeconds: null },
      { week: "Week 2", day: "Day 1", exerciseName: "Squat", sets: 3, reps: "6", weight: 210, rpe: null, rest: null, timeSeconds: null },
      { week: "Week 1", day: "Day 2", exerciseName: "Curl", sets: 2, reps: "12", weight: null, rpe: null, rest: null, timeSeconds: null },
    ]);

    expect(weeks.map((w) => w.weekLabel)).toEqual(["Week 1", "Week 2"]);
    expect(weeks[0].weekNumber).toBe(1);
    expect(weeks[1].weekNumber).toBe(2);
    expect(weeks[0].days.map((d) => d.dayLabel)).toEqual(["Day 2", "Day 1"]);
    expect(weeks[0].days[0].exercises.map((e) => e.exerciseName)).toEqual(["Row", "Curl"]);
    expect(weeks[1].days[0].exercises.map((e) => e.exerciseName)).toEqual(["Squat"]);
  });

  it("falls back to positional week numbers when the label has no digits", () => {
    const weeks = groupIntoWeeks([
      { week: "Base", day: "Day 1", exerciseName: "Squat", sets: 3, reps: "5", weight: null, rpe: null, rest: null, timeSeconds: null },
      { week: "Peak", day: "Day 1", exerciseName: "Squat", sets: 3, reps: "3", weight: null, rpe: null, rest: null, timeSeconds: null },
    ]);
    expect(weeks.map((w) => w.weekNumber)).toEqual([1, 2]);
  });
});
