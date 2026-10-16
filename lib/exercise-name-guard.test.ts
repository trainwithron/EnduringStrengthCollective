import { describe, it, expect } from "vitest";
import { isNumericOnlyName, numericOnlyNames, noSetsWarning, fitprosLayoutMessage } from "@/lib/exercise-name-guard";
import { parseFitprosExport, planFitprosImport, summarizePlan } from "@/lib/fitpros-history";
import { looksLikeNumbersNotNames } from "@/lib/workout-import-parser";

describe("numbers-only names", () => {
  it("digits, commas, dots and spaces only are not names", () => {
    for (const n of ["1", "8,8,8", "20", "5,5,5", "12.5", " 3 "]) expect(isNumericOnlyName(n)).toBe(true);
  });
  it("real names that contain numbers are safe", () => {
    for (const n of ["5/3/1", "21s", "Day 1", "10x10", "Squat", "1.5 Rep Squat", "", "...", " "]) expect(isNumericOnlyName(n)).toBe(false);
    expect(looksLikeNumbersNotNames(["5/3/1", "21s", "Day 1", "10x10"])).toBe(false);
  });
  it("lists each numeric name once", () => {
    expect(numericOnlyNames(["Squat", "1", "1", "8,8,8"])).toEqual(["1", "8,8,8"]);
  });
  it("one numeric name stops a program import", () => {
    expect(looksLikeNumbersNotNames(["Squat", "Bench", "20"])).toBe(true);
  });
});

describe("FitPros layouts", () => {
  const head = "## 2026-01-05 | Upper | 60\n";
  it("a normal one-line exercise is unchanged", () => {
    const r = parseFitprosExport(head + "Bench Press | 5,5,5 | 135,135,135");
    expect(r.problems).toEqual([]);
    expect(r.workouts[0].exercises[0].name).toBe("Bench Press");
    expect(r.workouts[0].exercises[0].sets.length).toBe(3);
  });
  it("Sawyer layout: a badge line with data attaches to the exercise on the line before", () => {
    const r = parseFitprosExport(head + "Bench Press\nFIRST TIME | 5,5,5 | 135,135,135\nRow\nPR 2 | 8,8 | 100,100");
    expect(r.problems).toEqual([]);
    const ex = r.workouts[0].exercises;
    expect(ex.map((e) => e.name)).toEqual(["Bench Press", "Row"]);
    expect(ex[0].sets.length).toBe(3);
    expect(ex[1].sets.length).toBe(2);
  });
  it("a data-only line (reps on their own line) also attaches", () => {
    const r = parseFitprosExport(head + "Squat\n8,8,8 | 200,200,200");
    expect(r.problems).toEqual([]);
    expect(r.workouts[0].exercises).toHaveLength(1);
    expect(r.workouts[0].exercises[0].sets.length).toBe(3);
  });
  it("a badge followed by a real name is an exercise line", () => {
    const r = parseFitprosExport(head + "PR | Deadlift | 3 | 315");
    expect(r.problems).toEqual([]);
    expect(r.workouts[0].exercises[0].name).toBe("Deadlift");
  });
  it("number lines with nothing to attach to stop the import and never become exercises", () => {
    const r = parseFitprosExport(head + "8,8,8 | 200\n20");
    expect(r.problems).toEqual(["8,8,8 | 200", "20"]);
    expect(r.workouts.flatMap((w) => w.exercises)).toEqual([]);
    expect(fitprosLayoutMessage(r.problems)).toBe(
      "These lines look like sets, not exercise names: 8,8,8 | 200; 20. The file may be laid out wrongly (each exercise should be one line: name | reps | weights)."
    );
  });
  it("a data line after an exercise that already has sets is a problem, not a new exercise", () => {
    const r = parseFitprosExport(head + "Bench | 5 | 100\n8,8,8 | 50");
    expect(r.problems).toEqual(["8,8,8 | 50"]);
  });
});

describe("no-sets warning", () => {
  it("shows above 10 percent, not at or below", () => {
    expect(noSetsWarning(1, 10)).toBeNull();
    expect(noSetsWarning(0, 10)).toBeNull();
    expect(noSetsWarning(2, 10)).toBe("2 of 10 exercises have no sets. Check the file layout.");
    expect(noSetsWarning(0, 0)).toBeNull();
  });
  it("counts exercises with no sets, notes excluded", () => {
    const text = "## 2026-01-05 | Upper | 60\nA | 5 | 100\nB\nC | | | | | felt sore\nD | 5 | 100";
    const plan = planFitprosImport(parseFitprosExport(text).workouts, [], null, new Set());
    const s = summarizePlan(plan);
    expect(s.exerciseLines).toBe(4);
    expect(s.withoutSets).toBe(1);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isBadExerciseName, isPrescriptionName, splitPrescriptionName, usableExerciseNames, PRESCRIPTION_MESSAGE, badExerciseNameMessage } from "@/lib/exercise-name-guard";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("names that carry sets and reps", () => {
  it("are recognised", () => {
    for (const n of ["Sumo Squat 3x10", "Bench 3 x 8-12", "Bench 3×5", "bench 5x5 @7", "Squat 3 sets", "Squat 3 sets of 10", "Squat 10 reps", "Row @7", "10x10"]) expect(isPrescriptionName(n)).toBe(true);
  });
  it("real names are untouched", () => {
    for (const n of ["Sumo Squat", "21s", "5/3/1", "Day 1", "Hex Bar Deadlift", "Barbell Back Squat", "3 Rep Pause Squat", "1.5 Rep Squat", "Wall Sit", "T-Bar Row 2"]) {
      expect(isPrescriptionName(n)).toBe(false);
      expect(isBadExerciseName(n)).toBe(false);
    }
  });
  it("sumo squat 3x10 splits to Sumo Squat + 3x10, like the Quick add box", () => {
    expect(splitPrescriptionName("sumo squat 3x10")).toEqual({ name: "Sumo Squat", sets: 3, reps: "10", timeSeconds: null, rpe: null });
    expect(splitPrescriptionName("Bench 5x5 @7")).toEqual({ name: "Bench", sets: 5, reps: "5", timeSeconds: null, rpe: 7 });
    expect(splitPrescriptionName("Row 3x8-12")?.reps).toBe("8-12");
    expect(splitPrescriptionName("Sumo Squat")).toBeNull();
    expect(splitPrescriptionName("Squat 3 sets of 10")).toBeNull(); // cannot be read: refused, never kept as a name
    expect(splitPrescriptionName("3x10")).toBeNull();
  });
  it("bad names are kept out of every suggestion list, with plain messages", () => {
    expect(usableExerciseNames(["Sumo Squat", "Sumo Squat 3x10", "1", "8,8,8", "5/3/1", "21s"])).toEqual(["Sumo Squat", "5/3/1", "21s"]);
    expect(badExerciseNameMessage("Sumo Squat 3x10")).toBe("That looks like sets and reps, not an exercise name.");
    expect(PRESCRIPTION_MESSAGE).toBe("That looks like sets and reps, not an exercise name.");
    expect(badExerciseNameMessage("20")).toBe("A name made only of numbers can't be added to your library.");
  });
});

describe("where the guard is used", () => {
  const card = src("components/coach/exercise-builder-card.tsx");
  it("the builder card no longer adds anything to the library by itself; Add to my library is the only way and is guarded", () => {
    const commit = card.slice(card.indexOf("async function handleNameCommit"), card.indexOf("async function handleMovementPatternChange"));
    expect(commit).not.toContain("exercise_library");
    expect(commit).toContain("splitPrescriptionName(trimmed)");
    expect(commit).toContain("exercise.sets.length === 0");
    const add = card.slice(card.indexOf("async function addToLibrary"), card.indexOf("const [presetBusy"));
    expect(add).toContain("isBadExerciseName(exercise.exerciseName)");
    expect(add).toContain("length < 3");
  });
  it("every library and alias insert, and every suggestion list, is guarded", () => {
    expect(src("components/coach/desktop/import-wizard.tsx")).toContain("isBadExerciseName(name)");
    expect(src("components/coach/desktop/import-wizard.tsx")).toContain("isBadExerciseName(alias.exerciseName)");
    expect(src("components/coach/fitpros-history-import.tsx")).toContain("isBadExerciseName(name)");
    expect(src("components/coach/exercise-library-list.tsx")).toContain("isBadExerciseName(trimmed)");
    expect(src("components/coach/exercise-name-input.tsx")).toContain("usableExerciseNames(suggestions)");
    expect(src("lib/program-builder-data.ts")).toContain("usableExerciseNames(");
    expect(src("app/api/ai/build-day/route.ts")).toContain("isBadExerciseName(r.name");
    expect(src("components/coach/desktop/day-card.tsx")).toContain("usableExerciseNames(fullLibrary)");
  });
});
