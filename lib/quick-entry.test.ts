import { describe, it, expect } from "vitest";
import { parseQuickEntry, quickNote } from "./quick-entry";

const reps = (exerciseName: string, sets: number, r: string, rpe: number | null = null) => ({ exerciseName, sets, reps: r, timeSeconds: null, rpe, eachSide: false, rangeNote: null });
const timed = (exerciseName: string, sets: number, timeSeconds: number, extra: { rpe?: number | null; eachSide?: boolean; rangeNote?: string | null } = {}) => ({
  exerciseName,
  sets,
  reps: null,
  timeSeconds,
  rpe: extra.rpe ?? null,
  eachSide: extra.eachSide ?? false,
  rangeNote: extra.rangeNote ?? null,
});

describe("parseQuickEntry: sets and reps (unchanged)", () => {
  it("parses name, sets, reps, and RPE", () => {
    expect(parseQuickEntry("Bench 3x5 @7")).toEqual(reps("Bench", 3, "5", 7));
  });
  it("parses without RPE", () => {
    expect(parseQuickEntry("Squat 4x8")).toEqual(reps("Squat", 4, "8"));
  });
  it("accepts a rep range", () => {
    expect(parseQuickEntry("Row 3x8-12 @8")).toEqual(reps("Row", 3, "8-12", 8));
  });
  it("accepts a multi-word exercise name", () => {
    expect(parseQuickEntry("Barbell Overhead Press 5x5")).toEqual(reps("Barbell Overhead Press", 5, "5"));
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

describe("parseQuickEntry: timed work is time, never reps", () => {
  it('Ron\'s case: "planks 60 seconds" is 3 sets of 60 seconds', () => {
    expect(parseQuickEntry("planks 60 seconds")).toEqual(timed("planks", 3, 60));
  });
  it("every way of writing a duration", () => {
    expect(parseQuickEntry("Plank 60s")).toEqual(timed("Plank", 3, 60));
    expect(parseQuickEntry("Plank 60 sec")).toEqual(timed("Plank", 3, 60));
    expect(parseQuickEntry("Plank 60 secs")).toEqual(timed("Plank", 3, 60));
    expect(parseQuickEntry("Plank 1 min")).toEqual(timed("Plank", 3, 60));
    expect(parseQuickEntry("Plank 1:00")).toEqual(timed("Plank", 3, 60));
    expect(parseQuickEntry("Plank 1:30")).toEqual(timed("Plank", 3, 90));
    expect(parseQuickEntry("Plank 1.5 minutes")).toEqual(timed("Plank", 3, 90));
  });
  it("with sets typed: 3x60s and 3 x 1 min", () => {
    expect(parseQuickEntry("Plank 3x60s")).toEqual(timed("Plank", 3, 60));
    expect(parseQuickEntry("Wall sit 4 x 1 min")).toEqual(timed("Wall sit", 4, 60));
    expect(parseQuickEntry("Dead hang 2x45 seconds")).toEqual(timed("Dead hang", 2, 45));
  });
  it('"45s each side" is 45 seconds, flagged each side', () => {
    expect(parseQuickEntry("Side plank 45s each side")).toEqual(timed("Side plank", 3, 45, { eachSide: true }));
    expect(parseQuickEntry("Side plank 3x45s per side @7")).toEqual(timed("Side plank", 3, 45, { eachSide: true, rpe: 7 }));
  });
  it("a bare number on a known timed hold is seconds, with or without sets", () => {
    expect(parseQuickEntry("Plank 60")).toEqual(timed("Plank", 3, 60));
    expect(parseQuickEntry("Plank 3x60")).toEqual(timed("Plank", 3, 60));
    expect(parseQuickEntry("Wall sit 3x45")).toEqual(timed("Wall sit", 3, 45));
    expect(parseQuickEntry("Hollow hold 30")).toEqual(timed("Hollow hold", 3, 30));
  });
  it("a bare number on anything else is NOT guessed", () => {
    expect(parseQuickEntry("Squat 60")).toBeNull();
    expect(parseQuickEntry("Bench 100")).toBeNull();
  });
  it("a small bare number on a hold is not seconds (1 to 4)", () => {
    expect(parseQuickEntry("Plank 3")).toBeNull();
    expect(parseQuickEntry("Plank 3x3")).toEqual(reps("Plank", 3, "3"));
  });
  it('a duration first is one effort: "5 minute row", "20 min bike"', () => {
    expect(parseQuickEntry("5 minute row")).toEqual(timed("Row", 1, 300));
    expect(parseQuickEntry("20 min bike")).toEqual(timed("Bike", 1, 1200));
  });
  it("a long effort typed after the name is one effort, like the leading form: Bike 20 min is 1 x 1200", () => {
    expect(parseQuickEntry("Row 5 min")).toEqual(timed("Row", 1, 300));
    expect(parseQuickEntry("Bike 20 min")).toEqual(timed("Bike", 1, 1200));
    expect(parseQuickEntry("Run 30 minutes")).toEqual(timed("Run", 1, 1800));
  });
  it("a hold or a short effort after the name is repeated for the default 3 sets", () => {
    expect(parseQuickEntry("Plank 60s")).toEqual(timed("Plank", 3, 60));
    expect(parseQuickEntry("Sprint 10 s")).toEqual(timed("Sprint", 3, 10));
    expect(parseQuickEntry("Wall sit 2 min")).toEqual(timed("Wall sit", 3, 120));
    expect(parseQuickEntry("Dead hang 3 min")).toEqual(timed("Dead hang", 3, 180));
  });
  it("an explicit set count is never changed: 3x5 min stays three sets", () => {
    expect(parseQuickEntry("Tempo run 3x5 min")).toEqual(timed("Tempo run", 3, 300));
  });
  it("a range of seconds uses the upper end and keeps the range as a note", () => {
    expect(parseQuickEntry("Plank 30-45s")).toEqual(timed("Plank", 3, 45, { rangeNote: "30-45s" }));
    expect(parseQuickEntry("Plank 30-45 seconds")).toEqual(timed("Plank", 3, 45, { rangeNote: "30-45 seconds" }));
    expect(parseQuickEntry("Side plank 3x20-30s each side")).toEqual(timed("Side plank", 3, 30, { eachSide: true, rangeNote: "20-30s" }));
    expect(parseQuickEntry("Dead hang 1-2 min")).toEqual(timed("Dead hang", 3, 120, { rangeNote: "1-2 min" }));
  });
  it("the saved note carries each side and the range", () => {
    expect(quickNote({ eachSide: true, rangeNote: null })).toBe("Each side");
    expect(quickNote({ eachSide: false, rangeNote: "30-45s" })).toBe("Hold 30-45s");
    expect(quickNote({ eachSide: true, rangeNote: "30-45s" })).toBe("Each side. Hold 30-45s");
    expect(quickNote({ eachSide: false, rangeNote: null })).toBeNull();
  });
  it("a plank that moves is counted in reps, not held for time", () => {
    expect(parseQuickEntry("Plank row 3x10")).toEqual(reps("Plank row", 3, "10"));
    expect(parseQuickEntry("Plank row 30")).toBeNull();
    expect(parseQuickEntry("Plank hip dips 3x12")).toEqual(reps("Plank hip dips", 3, "12"));
    expect(parseQuickEntry("Plank with leg lift 3x10")).toEqual(reps("Plank with leg lift", 3, "10"));
    expect(parseQuickEntry("Plank twist 3x12")).toEqual(reps("Plank twist", 3, "12"));
    expect(parseQuickEntry("Spiderman plank 3x10")).toEqual(reps("Spiderman plank", 3, "10"));
  });
  it("but with a unit typed, even a moving plank is time", () => {
    expect(parseQuickEntry("Plank hip dips 30s")).toEqual(timed("Plank hip dips", 3, 30));
  });
  it("a plain plank with a position word is still a hold", () => {
    expect(parseQuickEntry("Forearm plank 60")).toEqual(timed("Forearm plank", 3, 60));
    expect(parseQuickEntry("Side plank 30")).toEqual(timed("Side plank", 3, 30));
    expect(parseQuickEntry("Copenhagen plank 3x20")).toEqual(timed("Copenhagen plank", 3, 20));
  });
  it('regression: "3x10 squats" style stays reps', () => {
    expect(parseQuickEntry("Squat 3x10")).toEqual(reps("Squat", 3, "10"));
    expect(parseQuickEntry("Goblet squat 4x12 @8")).toEqual(reps("Goblet squat", 4, "12", 8));
  });
  it("an absurd set count on a timed line is rejected too", () => {
    expect(parseQuickEntry("Plank 99x60s")).toBeNull();
  });
});
