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

describe("parseHistoryRows: strict reading, reasons and row numbers", () => {
  const mapping = { date: 0, exercise: 1, weight: 2, reps: 3, rpe: 4 };

  it("never turns a rep range into one big number (8-12 is not 812)", () => {
    const { rows, skipped } = parseHistoryRows([["2026-01-05", "Back Squat", "225", "8-12", ""]], mapping);
    expect(rows).toHaveLength(0);
    expect(skipped).toEqual([{ rowNumber: 2, reason: "reps_not_count", detail: expect.stringContaining("8-12") }]);
  });

  it("reads a count with a word after it, but not a list", () => {
    const ok = parseHistoryRows([["2026-01-05", "Squat", "225", "5 reps", ""], ["2026-01-05", "Squat", "225", "5.0", ""]], mapping);
    expect(ok.rows.map((r) => r.reps)).toEqual([5, 5]);
    const list = parseHistoryRows([["2026-01-05", "Squat", "225", "8/8/6", ""]], mapping);
    expect(list.skipped[0].reason).toBe("reps_not_count");
  });

  it("a weight that is a range or a note is not read as its first number", () => {
    const { rows, skipped } = parseHistoryRows([["2026-01-05", "Squat", "135-185", "5", ""], ["2026-01-05", "Squat", "BW+25", "5", ""]], mapping);
    expect(rows).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(["weight_not_number", "weight_not_number"]);
  });

  it("a word with no number ('BW') is a bodyweight set, kept", () => {
    const { rows } = parseHistoryRows([["2026-01-05", "Pull-Up", "BW", "10", ""]], mapping);
    expect(rows[0]).toMatchObject({ weight: null, reps: 10 });
  });

  it("an RPE that is words is skipped; '@8' and 'RPE 8.5' are read", () => {
    const bad = parseHistoryRows([["2026-01-05", "Squat", "225", "5", "hard"]], mapping);
    expect(bad.skipped[0].reason).toBe("rpe_not_number");
    const ok = parseHistoryRows([["2026-01-05", "Squat", "225", "5", "@8"], ["2026-01-05", "Squat", "225", "5", "RPE 8.5"]], mapping);
    expect(ok.rows.map((r) => r.rpe)).toEqual([8, 8.5]);
  });

  it("lists every skipped row with its row number in the file (header is row 1), and not a blank spacer row", () => {
    const { rows, skipped, skippedCount } = parseHistoryRows(
      [
        ["2026-01-05", "Squat", "225", "5", ""],
        ["", "", "", "", ""],
        ["whenever", "Squat", "225", "5", ""],
        ["2026-01-06", "", "225", "5", ""],
        ["2026-01-06", "Squat", "", "", ""],
      ],
      mapping
    );
    expect(rows).toHaveLength(1);
    expect(skippedCount).toBe(3);
    expect(skipped.map((s) => [s.rowNumber, s.reason])).toEqual([[4, "bad_date"], [5, "no_exercise"], [6, "no_data"]]);
  });

  it("a value past what a real set can be is kept as an unclear data point for a coach, skipped for anyone else", () => {
    const row = [["2026-01-05", "Squat", "5280", "5", ""]];
    const coach = parseHistoryRows(row, mapping, { canFlag: true });
    expect(coach.rows[0].unclearReason).toContain("5,280");
    expect(coach.rows[0].weight).toBe(5280);
    const athlete = parseHistoryRows(row, mapping, { canFlag: false });
    expect(athlete.rows).toHaveLength(0);
    expect(athlete.skipped[0].reason).toBe("needs_coach");
  });

  it("a value past what the database can hold at all is skipped for everyone", () => {
    const { rows, skipped } = parseHistoryRows([["2026-01-05", "Squat", "225", "99999999", ""], ["2026-01-05", "Squat", "52800", "5", ""]], mapping, { canFlag: true });
    expect(rows).toHaveLength(0);
    expect(skipped.map((s) => s.reason)).toEqual(["too_big", "too_big"]);
  });

  it("a kilogram file is checked against the limit in pounds", () => {
    const { rows } = parseHistoryRows([["2026-01-05", "Squat", "950 kg", "1", ""]], mapping, { canFlag: true });
    expect(rows[0].unclearReason).toBeTruthy();
  });
});
