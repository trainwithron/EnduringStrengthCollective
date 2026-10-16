import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import {
  EXERCISE_NUMBERS_MESSAGE,
  bestExerciseColumn,
  detectColumns,
  groupIntoWeeks,
  isCounterHeader,
  looksLikeNumbersNotNames,
  mergeIdenticalSetRows,
  normalizeHeader,
  parseImportRows,
} from "@/lib/workout-import-parser";

// Reads a CSV the way the import wizard does.
function readCsv(text: string): { header: string[]; body: string[][] } {
  const workbook = XLSX.read(text, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const [header, ...body] = rows.map((r) => r.map((c) => String(c)));
  return { header, body };
}

describe("headers are compared the way a person reads them", () => {
  it("underscores, hyphens and repeated spaces are single spaces", () => {
    expect(normalizeHeader("Exercise_Name")).toBe("exercise name");
    expect(normalizeHeader("  Exercise -  Name ")).toBe("exercise name");
    expect(normalizeHeader("REST_TIME")).toBe("rest time");
  });
  it("a column that only counts the rows is a counter", () => {
    for (const h of ["Exercise_#", "Exercise #", "Exercise No", "Exercise No.", "Exercise Number", "Exercise Order", "Exercise Index", "Set #", "ID"]) expect(isCounterHeader(h)).toBe(true);
    for (const h of ["Exercise", "Exercise_Name", "Notes", "Movement", "Sets", "Week", "Day"]) expect(isCounterHeader(h)).toBe(false);
  });
});

describe("counts are not row numbers", () => {
  it("a header that says of, or is a count, is still the sets or reps column", () => {
    for (const h of ["Number of Sets", "No. of Sets", "# of Sets", "Set Count", "Rep Count", "Total Reps Count", "Number of Reps"]) expect(isCounterHeader(h)).toBe(false);
  });
  it("and each is found as the column it names", () => {
    expect(detectColumns(["Exercise", "Number of Sets", "Reps"])).toMatchObject({ exercise: 0, sets: 1, reps: 2 });
    expect(detectColumns(["Exercise", "No. of Sets", "Rep Count"])).toMatchObject({ sets: 1, reps: 2 });
    expect(detectColumns(["Exercise", "Set Count", "Total Reps Count"])).toMatchObject({ sets: 1, reps: 2 });
    expect(detectColumns(["Exercise", "# of Sets"])).toMatchObject({ sets: 1 });
  });
  it("the row-number columns are still skipped", () => {
    for (const h of ["Exercise #", "Set #", "Set Number", "Exercise No", "Exercise Index", "Exercise ID", "Exercise Order"]) expect(isCounterHeader(h)).toBe(true);
    expect(detectColumns(["Exercise", "Set Number", "Sets"])).toMatchObject({ sets: 2 });
  });
});

describe("finding the columns", () => {
  it("the exact header row from the Gemini program: the exercise column is Exercise_Name, not Exercise_#", () => {
    const header = ["Week", "Intensity_Phase", "Day", "Exercise_#", "Exercise_Name", "Sets", "Prescription", "Notes"];
    expect(detectColumns(header)).toEqual({ week: 0, day: 2, exercise: 4, sets: 5, prescription: 6 });
  });
  it("ChatGPT-style variants", () => {
    expect(detectColumns(["Exercise Name", "Sets", "Reps"])).toMatchObject({ exercise: 0, sets: 1, reps: 2 });
    expect(detectColumns(["exercise_name", "sets", "reps"])).toMatchObject({ exercise: 0 });
    // a counter BEFORE the real column
    expect(detectColumns(["Exercise #", "Exercise", "Sets"])).toMatchObject({ exercise: 1 });
    expect(detectColumns(["No", "Exercise No", "Movement", "Sets"])).toMatchObject({ exercise: 2 });
    expect(detectColumns(["#", "Exercise Number", "Exercise Name"])).toMatchObject({ exercise: 2 });
  });
  it("with two headers that contain the word, the one that says name wins; a lone counter is never used", () => {
    expect(detectColumns(["Exercise Type", "Exercise Name", "Sets"])).toMatchObject({ exercise: 1 });
    expect(detectColumns(["Exercise #", "Sets"]).exercise).toBeUndefined();
  });
  it("the other columns read underscores and hyphens too, and a set counter is not the sets column", () => {
    expect(detectColumns(["Macrocycle_Week", "Workout-Day", "Exercise", "Target_Reps", "Rest_Time"])).toMatchObject({ week: 0, day: 1, exercise: 2, reps: 3, rest: 4 });
    expect(detectColumns(["Exercise", "Set #", "Sets"])).toMatchObject({ sets: 2 });
  });
  it("what worked before still works", () => {
    expect(detectColumns(["Day", "Exercise Name", "Sets", "Reps", "Weight (lbs)", "RPE", "Rest"])).toEqual({ day: 0, exercise: 1, sets: 2, reps: 3, weight: 4, rpe: 5, rest: 6 });
  });
});

describe("the safety net", () => {
  it("any name that is only numbers is the wrong column", () => {
    expect(looksLikeNumbersNotNames(["1", "2", "3", "4"])).toBe(true);
    expect(looksLikeNumbersNotNames(["1", "2", "Squat"])).toBe(true);
    expect(looksLikeNumbersNotNames(["1", "Squat", "Bench", "Row"])).toBe(true); // any one is enough
    expect(looksLikeNumbersNotNames(["Squat", "Bench"])).toBe(false);
    expect(looksLikeNumbersNotNames(["", ""])).toBe(false);
    expect(looksLikeNumbersNotNames(["1.5", "2,5"])).toBe(true);
    expect(looksLikeNumbersNotNames(["21 Day Challenge Squat", "Bench"])).toBe(false);
    expect(EXERCISE_NUMBERS_MESSAGE).toBe("The exercise column looks like numbers, not names. Pick the column with the exercise names.");
  });
  it("the picker starts on the column most likely to hold the names", () => {
    const { header, body } = readCsv("Week,Day,Exercise_#,Exercise_Name,Sets\nWeek 1,Day 1,1,Squat,3\nWeek 1,Day 1,2,Bench Press,3\nWeek 1,Day 1,3,Row,3\n");
    expect(bestExerciseColumn(header, body)).toBe(3);
    // even with no helpful header
    const plain = readCsv("A,B,C\n1,Squat,3\n2,Bench Press,3\n3,Row,3\n");
    expect(bestExerciseColumn(plain.header, plain.body)).toBe(1);
    expect(bestExerciseColumn(["A"], [["1"], ["2"]])).toBeNull();
  });
  it("the wrong column picked by hand is caught before anything imports", () => {
    const { header, body } = readCsv("Exercise_#,Exercise_Name,Sets\n1,Squat,3\n2,Bench,3\n3,Row,3\n");
    // the old behaviour: the counter column chosen
    const wrong = parseImportRows(body, { exercise: 0, sets: 2 });
    expect(looksLikeNumbersNotNames(wrong.map((r) => r.exerciseName))).toBe(true);
    // the detection now picks the names
    const right = parseImportRows(body, detectColumns(header));
    expect(right.map((r) => r.exerciseName)).toEqual(["Squat", "Bench", "Row"]);
  });
});

describe("the Gemini program file, exactly as Ron uploaded it", () => {
  const { header, body } = readCsv(readFileSync(join(__dirname, "fixtures/gemini-program.csv"), "utf8"));
  const mapping = detectColumns(header);
  const parsed = mergeIdenticalSetRows(parseImportRows(body, mapping));
  const weeks = groupIntoWeeks(parsed);

  it("reads the exercise names, not 1, 2, 3", () => {
    expect(mapping.exercise).toBe(4);
    expect(parsed.some((r) => /^\d+$/.test(r.exerciseName))).toBe(false);
    expect(looksLikeNumbersNotNames(parsed.map((r) => r.exerciseName))).toBe(false);
    expect(weeks[0].days[0].exercises.map((e) => e.exerciseName).slice(0, 3)).toEqual(["Broad Jumps For Distance (Short Contact Time)", "Trap Bar Deadlift", "Reverse Alternating Lunges"]);
  });
  it("three sets of the right reps", () => {
    const [jumps, deadlift, , , , curl] = weeks[0].days[0].exercises;
    expect(jumps).toMatchObject({ sets: 3, reps: "3" });
    expect(deadlift).toMatchObject({ sets: 3, reps: "5" });
    expect(curl).toMatchObject({ exerciseName: "Hamstring Curl Machine", sets: 3, reps: "8" });
  });
  it("a plank 'Time (sec): 2 sets' is two sets with no time target, not a 2 second hold", () => {
    const plank = weeks[0].days[0].exercises.find((e) => e.exerciseName === "Hollow Body Plank")!;
    expect(plank.sets).toBe(2);
    expect(plank.timeSeconds).toBeNull();
    expect(plank.reps).toBeNull();
  });
  it("weeks and days are right, in the order of the file", () => {
    expect(weeks).toHaveLength(12);
    expect(weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(weeks[0].days.map((d) => d.dayLabel)).toEqual(["Day 1", "Day 2", "Day 3"]);
    expect(weeks[0].days[0].exercises).toHaveLength(9);
  });
  it("the junk in the Notes column ('Weight (lb): 3 sets') is never read as a weight, a note or anything else", () => {
    expect(parsed.every((r) => r.weight == null && r.rpe == null)).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain("3 sets");
  });
});

describe("a ChatGPT-style file", () => {
  it("separate Reps, Weight and Rest columns with underscores, and a counter in front", () => {
    const { header, body } = readCsv("Exercise_No,Exercise_Name,Sets,Target_Reps,Target_Weight,Rest_Time,Day,Week\n1,Back Squat,4,6,225,120,Day 1,Week 1\n2,Romanian Deadlift,3,8,185,90,Day 1,Week 1\n");
    const parsed = mergeIdenticalSetRows(parseImportRows(body, detectColumns(header)));
    expect(parsed.map((r) => [r.exerciseName, r.sets, r.reps, r.weight, r.rest, r.day, r.week])).toEqual([
      ["Back Squat", 4, "6", 225, "120", "Day 1", "Week 1"],
      ["Romanian Deadlift", 3, "8", 185, "90", "Day 1", "Week 1"],
    ]);
  });
});

describe("prescription text that only counts sets", () => {
  it("'Reps: 3 sets' and 'Time (sec): 20 sets' are not targets; real targets still read", () => {
    const body = [
      ["Week 1", "Day 1", "Plank", "2", "Time (sec): 20 sets"],
      ["Week 1", "Day 1", "Plank hold", "2", "Time (sec): 20 x 2"],
      ["Week 1", "Day 1", "Curl", "3", "Reps: 3 sets"],
      ["Week 1", "Day 1", "Curl 2", "3", "Reps: 12 x 3"],
    ];
    const parsed = parseImportRows(body, { week: 0, day: 1, exercise: 2, sets: 3, prescription: 4 });
    expect(parsed.map((r) => [r.reps, r.timeSeconds])).toEqual([
      [null, null],
      [null, 20],
      [null, null],
      ["12", null],
    ]);
  });
});

describe("the wizard", () => {
  const wizard = readFileSync(join(__dirname, "..", "components/coach/desktop/import-wizard.tsx"), "utf8").replace(/\r\n/g, "\n");
  it("stops with the plain message and a column picker, for every source, before anything is read", () => {
    expect(wizard).toContain("askForColumn(EXERCISE_NUMBERS_MESSAGE);");
    expect(wizard).toContain("Column with the exercise names");
    expect(wizard).toContain("Use this column");
    // the same check at the start of prepareImport covers photos, PDFs, pasted text and AI too
    expect(wizard.indexOf("looksLikeNumbersNotNames(parsed.map((r) => r.exerciseName))")).toBeGreaterThan(wizard.indexOf("function prepareImport("));
  });
  it("the program name drops the file extension (and only a real extension)", () => {
    expect(wizard).toContain('fileName.replace(/\\.(csv|xlsx|xls)$/i, "")');
    const strip = (name: string) => name.replace(/\.(csv|xlsx|xls)$/i, "");
    expect(strip("maria_program.csv")).toBe("maria_program");
    expect(strip("Plan.XLSX")).toBe("Plan");
    expect(strip("csv notes")).toBe("csv notes");
    expect(strip("planxcsv")).toBe("planxcsv");
  });
});
