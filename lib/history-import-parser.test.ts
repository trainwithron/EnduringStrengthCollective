import { describe, it, expect } from "vitest";
import { detectHistoryColumns, parseFlexibleDate, parseHistoryRows } from "./history-import-parser";

describe("detectHistoryColumns", () => {
  it("maps exact header names", () => {
    const mapping = detectHistoryColumns(["Date", "Exercise", "Weight", "Reps", "RPE"]);
    expect(mapping).toEqual({ date: 0, exercise: 1, weight: 2, reps: 3, rpe: 4 });
  });

  it("maps a substring/aliased header", () => {
    const mapping = detectHistoryColumns(["Session Date", "Exercise Name", "Load (lbs)", "Rep"]);
    expect(mapping.date).toBe(0);
    expect(mapping.exercise).toBe(1);
    expect(mapping.weight).toBe(2);
    expect(mapping.reps).toBe(3);
  });

  it("leaves a column unset when nothing matches", () => {
    const mapping = detectHistoryColumns(["Date", "Exercise"]);
    expect(mapping.weight).toBeUndefined();
    expect(mapping.rpe).toBeUndefined();
  });
});

describe("parseFlexibleDate", () => {
  it("parses ISO dates", () => {
    expect(parseFlexibleDate("2026-01-05")).toBe("2026-01-05");
  });

  it("parses US slash dates, including single-digit month/day", () => {
    expect(parseFlexibleDate("1/5/2026")).toBe("2026-01-05");
  });

  it("parses US dash dates with a 2-digit year", () => {
    expect(parseFlexibleDate("1-5-26")).toBe("2026-01-05");
  });

  it("returns null for garbage input", () => {
    expect(parseFlexibleDate("not a date")).toBeNull();
    expect(parseFlexibleDate("")).toBeNull();
  });

  it("returns null for an out-of-range month or day", () => {
    expect(parseFlexibleDate("13/40/2026")).toBeNull();
  });
});

describe("parseHistoryRows", () => {
  const mapping = { date: 0, exercise: 1, weight: 2, reps: 3, rpe: 4 };

  it("parses a well-formed row", () => {
    const { rows, skippedCount } = parseHistoryRows([["2026-01-05", "Back Squat", "225", "5", "8"]], mapping);
    expect(skippedCount).toBe(0);
    expect(rows).toEqual([{ date: "2026-01-05", exerciseName: "Back Squat", weight: 225, reps: 5, rpe: 8 }]);
  });

  it("skips a row with no exercise name", () => {
    const { rows, skippedCount } = parseHistoryRows([["2026-01-05", "", "225", "5", ""]], mapping);
    expect(rows).toHaveLength(0);
    expect(skippedCount).toBe(1);
  });

  it("skips a row with an unparseable date", () => {
    const { rows, skippedCount } = parseHistoryRows([["whenever", "Back Squat", "225", "5", ""]], mapping);
    expect(rows).toHaveLength(0);
    expect(skippedCount).toBe(1);
  });

  it("skips a row with neither weight nor reps", () => {
    const { rows, skippedCount } = parseHistoryRows([["2026-01-05", "Back Squat", "", "", ""]], mapping);
    expect(rows).toHaveLength(0);
    expect(skippedCount).toBe(1);
  });

  it("keeps a bodyweight row with reps but no weight", () => {
    const { rows, skippedCount } = parseHistoryRows([["2026-01-05", "Pull-Up", "", "12", ""]], mapping);
    expect(skippedCount).toBe(0);
    expect(rows).toEqual([{ date: "2026-01-05", exerciseName: "Pull-Up", weight: null, reps: 12, rpe: null }]);
  });
});
