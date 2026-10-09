import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exerciseKey, findLibraryVariant, matchExercise, matchTopN } from "./exercise-matching";
import { existingLibraryName, isExistingExercise } from "./exercise-search";

const read = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the same exercise written differently has the same key", () => {
  it("case, spaces, hyphens, punctuation and one trailing s are ignored", () => {
    expect(exerciseKey("Deadlifts")).toBe(exerciseKey("Deadlift"));
    expect(exerciseKey("Pull-Up")).toBe(exerciseKey("pull up"));
    expect(exerciseKey("Pull-Ups")).toBe(exerciseKey("pullup"));
    expect(exerciseKey("Step Ups")).toBe(exerciseKey("Step Up"));
    expect(exerciseKey("Shoulder CARs")).toBe(exerciseKey("Shoulder CARS"));
    expect(exerciseKey("Farmer's Carry")).toBe(exerciseKey("Farmers Carry"));
    expect(exerciseKey("Band Pull-Apart")).toBe(exerciseKey("Band Pull Apart"));
    expect(exerciseKey("Lat Pull Down")).toBe(exerciseKey("Lat Pulldown"));
  });
  it("only ONE trailing s is dropped, and different exercises stay different", () => {
    expect(exerciseKey("Dips")).toBe("dip");
    expect(exerciseKey("Press")).toBe("pres");
    expect(exerciseKey("Bench Press")).not.toBe(exerciseKey("Overhead Press"));
    expect(exerciseKey("Deadlift")).not.toBe(exerciseKey("Romanian Deadlift"));
    expect(exerciseKey("")).toBe("");
    expect(exerciseKey("s")).toBe("s");
  });
});

describe("a typed name that already exists resolves to the existing entry", () => {
  const library = ["Deadlift", "Pull-Up", "Step Up", "Shoulder CARs", "Farmer's Carry", "Bench Press"];
  it("finds the library spelling", () => {
    expect(findLibraryVariant("deadlifts", library)).toBe("Deadlift");
    expect(findLibraryVariant("Pull Ups", library)).toBe("Pull-Up");
    expect(findLibraryVariant("Step Ups", library)).toBe("Step Up");
    expect(findLibraryVariant("Shoulder CARS", library)).toBe("Shoulder CARs");
    expect(findLibraryVariant("Farmers Carry", library)).toBe("Farmer's Carry");
    expect(findLibraryVariant("Squat", library)).toBeNull();
  });
  it("an exact spelling wins over a variant", () => {
    expect(findLibraryVariant("Dips", ["Dip", "Dips"])).toBe("Dips");
    expect(findLibraryVariant("dips", ["Dip", "Dips"])).toBe("Dips");
  });
  it('the dropdown does not offer "Add as a new exercise" for a variant that exists, and names the existing one', () => {
    expect(isExistingExercise("deadlifts", library)).toBe(true);
    expect(isExistingExercise("Pull Up", library)).toBe(true);
    expect(isExistingExercise("Zercher Squat", library)).toBe(false);
    expect(isExistingExercise("   ", library)).toBe(false);
    expect(existingLibraryName("deadlifts", library)).toBe("Deadlift");
    expect(existingLibraryName("", library)).toBeNull();
  });
});

describe("the importer and the quick-add line match the same way", () => {
  const lib = [{ name: "Deadlift" }, { name: "Pull-Up" }, { name: "Farmer's Carry" }, { name: "Shoulder CARs" }];
  it("a variant is an exact match, not a new exercise", () => {
    expect(matchExercise("deadlifts", lib, [])).toMatchObject({ exerciseName: "Deadlift", confidence: "exact" });
    expect(matchExercise("Pull Ups", lib, [])).toMatchObject({ exerciseName: "Pull-Up", confidence: "exact" });
    expect(matchExercise("Farmers Carry", lib, [])).toMatchObject({ exerciseName: "Farmer's Carry", confidence: "exact" });
    expect(matchExercise("Shoulder CARS", lib, [])).toMatchObject({ exerciseName: "Shoulder CARs", confidence: "exact" });
  });
  it("a name that is not in the library still matches nothing, and an alias still wins", () => {
    expect(matchExercise("Zercher Squat", lib, []).confidence).toBe("none");
    expect(matchExercise("dl", lib, [{ rawName: "dl", exerciseName: "Deadlift" }])).toMatchObject({ confidence: "alias" });
  });
  it("the ranked list puts the variant first", () => {
    expect(matchTopN("deadlifts", lib, [])[0]).toMatchObject({ exerciseName: "Deadlift", score: 1 });
  });
});

describe("where the name is committed", () => {
  it("a typed name that is a spelling of a library exercise is committed as that exercise, and the library Add refuses a second row", () => {
    expect(read("components/coach/exercise-name-input.tsx")).toContain("existingLibraryName(text, suggestions) ?? capitalizeWords(text)");
    const list = read("components/coach/exercise-library-list.tsx");
    expect(list).toContain("const existingName = existingLibraryName(trimmed, exercises.map((e) => e.name));");
    expect(list.indexOf("existingLibraryName(trimmed")).toBeLessThan(list.indexOf('.from("exercise_library")\n      .insert('));
  });
});
