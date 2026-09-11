import { describe, it, expect } from "vitest";
import { detectColumns, parseImportRows, mergeIdenticalSetRows, groupIntoWeeks, type ParsedImportRow } from "./workout-import-parser";

function row(overrides: Partial<ParsedImportRow>): ParsedImportRow {
  return {
    week: "Week 1",
    day: "Day 1",
    exerciseName: "Lateral Jumps",
    sets: 1,
    reps: "8",
    weight: null,
    rpe: null,
    rest: null,
    timeSeconds: null,
    ...overrides,
  };
}

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

describe("mergeIdenticalSetRows", () => {
  it("merges the real repro case — three identical Sets=1 rows into one Sets=3 row", () => {
    const merged = mergeIdenticalSetRows([row({}), row({}), row({})]);
    expect(merged).toEqual([row({ sets: 3 })]);
  });

  it("does not merge a genuine ramp set — each row's own weight differs", () => {
    const rampRows = [
      row({ exerciseName: "Back Squat", reps: "5", weight: 135 }),
      row({ exerciseName: "Back Squat", reps: "5", weight: 185 }),
      row({ exerciseName: "Back Squat", reps: "3", weight: 225 }),
    ];
    expect(mergeIdenticalSetRows(rampRows)).toEqual(rampRows);
  });

  it("does not merge across a day boundary even with identical values otherwise", () => {
    const rows = [
      row({ day: "Day 1" }),
      row({ day: "Day 1" }),
      row({ day: "Day 2" }),
    ];
    const merged = mergeIdenticalSetRows(rows);
    expect(merged).toEqual([row({ day: "Day 1", sets: 2 }), row({ day: "Day 2", sets: 1 })]);
  });

  it("does not merge across a week boundary", () => {
    const rows = [row({ week: "Week 1" }), row({ week: "Week 2" })];
    expect(mergeIdenticalSetRows(rows)).toEqual(rows);
  });

  it("does not merge rows for a different exercise, even adjacent", () => {
    const rows = [row({ exerciseName: "Lateral Jumps" }), row({ exerciseName: "Box Jumps" })];
    expect(mergeIdenticalSetRows(rows)).toEqual(rows);
  });

  it("does not merge a row that already has sets > 1 (already correctly extracted)", () => {
    const rows = [row({ sets: 3 }), row({ sets: 1 })];
    expect(mergeIdenticalSetRows(rows)).toEqual(rows);
  });

  it("does not merge when rpe, rest, or timeSeconds differ", () => {
    const byRpe = [row({ rpe: 7 }), row({ rpe: 8 })];
    expect(mergeIdenticalSetRows(byRpe)).toEqual(byRpe);

    const byRest = [row({ rest: "60s" }), row({ rest: "90s" })];
    expect(mergeIdenticalSetRows(byRest)).toEqual(byRest);

    const byTime = [row({ reps: null, timeSeconds: 30 }), row({ reps: null, timeSeconds: 45 })];
    expect(mergeIdenticalSetRows(byTime)).toEqual(byTime);
  });

  it("only merges rows that are actually adjacent — a different exercise in between breaks the run", () => {
    const rows = [row({}), row({ exerciseName: "Box Jumps" }), row({})];
    expect(mergeIdenticalSetRows(rows)).toEqual(rows);
  });

  it("leaves a single row and an empty list unchanged", () => {
    expect(mergeIdenticalSetRows([row({})])).toEqual([row({})]);
    expect(mergeIdenticalSetRows([])).toEqual([]);
  });
});
