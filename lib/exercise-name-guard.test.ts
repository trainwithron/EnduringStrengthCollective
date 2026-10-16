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
