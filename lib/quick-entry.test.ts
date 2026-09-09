import { describe, it, expect } from "vitest";
import { parseQuickEntry } from "./quick-entry";

describe("parseQuickEntry", () => {
  it("parses name, sets, reps, and RPE", () => {
    expect(parseQuickEntry("Bench 3x5 @7")).toEqual({
      exerciseName: "Bench",
      sets: 3,
      reps: "5",
      rpe: 7,
    });
  });

  it("parses without RPE", () => {
    expect(parseQuickEntry("Squat 4x8")).toEqual({
      exerciseName: "Squat",
      sets: 4,
      reps: "8",
      rpe: null,
    });
  });

  it("accepts a rep range", () => {
    expect(parseQuickEntry("Row 3x8-12 @8")).toEqual({
      exerciseName: "Row",
      sets: 3,
      reps: "8-12",
      rpe: 8,
    });
  });

  it("accepts a multi-word exercise name", () => {
    expect(parseQuickEntry("Barbell Overhead Press 5x5")).toEqual({
      exerciseName: "Barbell Overhead Press",
      sets: 5,
      reps: "5",
      rpe: null,
    });
  });

  it("accepts the x separator case-insensitively and with the × glyph", () => {
    expect(parseQuickEntry("Bench 3X5")?.sets).toBe(3);
    expect(parseQuickEntry("Bench 3×5")?.sets).toBe(3);
  });

  it("accepts a decimal RPE", () => {
    expect(parseQuickEntry("Bench 3x5 @7.5")?.rpe).toBe(7.5);
  });

  it("rejects text with no sets x reps shorthand", () => {
    expect(parseQuickEntry("Bench")).toBeNull();
  });

  it("rejects a zero or absurd set count", () => {
    expect(parseQuickEntry("Bench 0x5")).toBeNull();
    expect(parseQuickEntry("Bench 99x5")).toBeNull();
  });

  it("rejects blank input", () => {
    expect(parseQuickEntry("   ")).toBeNull();
  });
});
