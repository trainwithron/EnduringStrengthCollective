import { describe, it, expect } from "vitest";
import {
  parseCsv,
  parseNutritionHistory,
  detectHistoryFormat,
  parseNumberCell,
  parseDateCell,
  slashedDateOrder,
  mealSlotOf,
  isCronometerTotalRow,
  previewLine,
  sampleLine,
  chunkByDay,
  checkImportRow,
  IMPORT_MAX_ROWS,
  UNRECOGNIZED_FILE,
  type ImportedFoodRow,
} from "./nutrition-history-import";

const TODAY = "2026-11-09";

const ok = (p: ReturnType<typeof parseNutritionHistory>) => {
  if (!p.ok) throw new Error(`expected a parse, got: ${p.error}`);
  return p;
};
const bad = (p: ReturnType<typeof parseNutritionHistory>) => {
  if (p.ok) throw new Error("expected a refusal");
  return p.error;
};

// Cronometer's "Servings" export: a BOM, quoted cells, a comma inside a food name, extra nutrient columns, a day-total row, and a real group someone named "Total".
const CRONOMETER = [
  "﻿Day,Time,Group,Food Name,Amount,Energy (kcal),Alcohol (g),Caffeine (mg),Water (g),B1 (Thiamine) (mg),Carbs (g),Fiber (g),Net Carbs (g),Fat (g),Protein (g),Category",
  '2026-08-03,07:12 AM,Breakfast,"Oatmeal, Rolled Oats",1.00 cup,307.2,0,0,8.1,0.4,54.8,8.2,46.6,5.3,10.7,Grains',
  '2026-08-03,07:12 AM,Breakfast,"Coffee, Brewed",2.00 cup,4.7,0,189,472,0,0,0,0,0.1,0.6,Beverages',
  "2026-08-03,,Lunch,Chicken Breast,150.00 g,247.5,0,0,96,0.1,0,0,0,5.4,46.5,Meats",
  "2026-08-03,,Snacks,Greek Yogurt,1.00 container,100,0,0,130,0,6,0,6,0.7,17,Dairy",
  "2026-08-03,,Total,,,659.4,0,189,706.1,0.5,60.8,8.2,52.6,11.5,74.8,",
  "2026-08-04,,Dinner,Salmon,6.00 oz,350,0,0,100,0.3,0,0,0,20,39,Fish",
  "2026-08-04,,Total,Protein Shake,1.00 scoop,120,0,0,0,0,3,0,3,1,24,Supplements",
  "2026-08-04,,Uncategorized,Apple,1 medium,95,0,0,156,0,25,4.4,20.6,0.3,0.5,Fruit",
  "",
].join("\r\n");

describe("CSV reading", () => {
  it("reads quotes, doubled quotes, commas and line breaks inside quotes, CRLF and a BOM", () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n1,2,3\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "two\nlines"],
      ["1", "2", "3"],
    ]);
  });
  it("reads a file a spreadsheet saved with semicolons or tabs", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("Cronometer servings export", () => {
  const p = ok(parseNutritionHistory(CRONOMETER, { todayKey: TODAY, fileName: "servings.csv" }));

  it("is recognized by its column names", () => {
    expect(p.source).toBe("cronometer");
    expect(p.sourceLabel).toBe("Cronometer");
  });
  it("reads one entry per food, with the meal from Group, and skips the day's total row", () => {
    expect(p.rows.map((r) => r.description)).toEqual(["Oatmeal, Rolled Oats", "Coffee, Brewed", "Chicken Breast", "Greek Yogurt", "Salmon", "Protein Shake", "Apple"]);
    expect(p.rows.map((r) => r.mealSlot)).toEqual(["breakfast", "breakfast", "lunch", "snack", "dinner", null, null]);
    expect(p.skipped).toEqual([{ rowNumber: 6, reason: "a day's total, not a food" }]);
  });
  it("keeps a real food in a group literally named Total", () => {
    const shake = p.rows.find((r) => r.description === "Protein Shake")!;
    expect(shake).toMatchObject({ date: "2026-08-04", mealSlot: null, calories: 120, proteinG: 24 });
  });
  it("reads the numbers by column name (Carbs (g), not Net Carbs or Fiber) and the Amount as the serving", () => {
    expect(p.rows[0]).toEqual({ date: "2026-08-03", mealSlot: "breakfast", description: "Oatmeal, Rolled Oats", servingLabel: "1.00 cup", calories: 307.2, proteinG: 10.7, carbsG: 54.8, fatG: 5.3 });
  });
  it("counts the days and the range", () => {
    expect(p.dayCount).toBe(2);
    expect(p.firstDate).toBe("2026-08-03");
    expect(p.lastDate).toBe("2026-08-04");
    expect(previewLine(p, TODAY)).toBe("Found 2 days, Aug 3 to Aug 4 · 7 foods");
  });
  it("tolerates reordered columns and uses Net Carbs when there is no Carbs column", () => {
    const csv = "Protein (g),Fat (g),Net Carbs (g),Energy (kcal),Food Name,Group,Day\n10,2,30,190,Toast,Breakfast,2026-09-01";
    const r = ok(parseNutritionHistory(csv, { todayKey: TODAY }));
    expect(r.rows[0]).toMatchObject({ date: "2026-09-01", description: "Toast", mealSlot: "breakfast", calories: 190, proteinG: 10, carbsG: 30, fatG: 2, servingLabel: null });
  });
  it("refuses a Cronometer file that has no protein column, naming it", () => {
    const err = bad(parseNutritionHistory("Day,Group,Food Name,Energy (kcal),Carbs (g),Fat (g)\n2026-09-01,Lunch,Rice,200,44,0.4", { todayKey: TODAY }));
    expect(err).toContain("Cronometer");
    expect(err).toContain("Protein");
    expect(err).toContain("Nothing was saved");
  });
  it("points the coach to Servings when given the daily summary", () => {
    const err = bad(parseNutritionHistory("Date,Energy (kcal),Protein (g),Carbs (g),Fat (g),Completed\n2026-09-01,2100,150,200,70,true", { todayKey: TODAY }));
    expect(err).toContain('export "Servings"');
  });
});

describe("MyFitnessPal nutrition export", () => {
  const MFP = [
    "Date,Meal,Time,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Cholesterol,Sodium (mg),Carbohydrates (g),Fiber,Sugar,Protein (g),Note",
    "2026-07-01,Breakfast,8:00 AM,450,15,5,2,180,600,50,6,12,30,",
    "2026-07-01,Lunch,,\"1,120\",40,10,4,90,1500,120,10,8,65,\"big lunch, ate out\"",
    "2026-07-01,Snacks,,200,9,2,1,0,100,20,3,10,8,",
    "2026-07-01,Total,,1770,64,17,7,270,2200,190,19,30,103,",
    "2026-07-02,,,,,,,,,,,,,",
    "2026-07-02,Dinner,,700,25,8,3,120,900,60,5,6,55,",
  ].join("\n");
  const p = ok(parseNutritionHistory(MFP, { todayKey: TODAY }));

  it("reads one entry per meal, described as that meal's MyFitnessPal total", () => {
    expect(p.source).toBe("myfitnesspal");
    expect(p.sourceLabel).toBe("MyFitnessPal");
    expect(p.rows.map((r) => r.description)).toEqual(["Breakfast (MyFitnessPal total)", "Lunch (MyFitnessPal total)", "Snacks (MyFitnessPal total)", "Dinner (MyFitnessPal total)"]);
    expect(p.rows.map((r) => r.mealSlot)).toEqual(["breakfast", "lunch", "snack", "dinner"]);
  });
  it("reads a quoted number with a thousands comma, and picks Fat (g), not Saturated Fat", () => {
    expect(p.rows[1]).toMatchObject({ calories: 1120, fatG: 40, carbsG: 120, proteinG: 65 });
  });
  it("skips the total row and a row with a date but no meal", () => {
    expect(p.skipped).toEqual([
      { rowNumber: 5, reason: "a day's total, not a meal" },
      { rowNumber: 6, reason: "no meal name" },
    ]);
    expect(previewLine(p, TODAY)).toBe("Found 2 days, Jul 1 to Jul 2 · 4 meal totals");
  });
  it("accepts the header without units and in another case", () => {
    const r = ok(parseNutritionHistory("DATE,MEAL,CALORIES,FAT,CARBOHYDRATES,PROTEIN\n2026-07-05,lunch,500,20,40,30", { todayKey: TODAY }));
    expect(r.rows[0]).toMatchObject({ mealSlot: "lunch", calories: 500, fatG: 20, carbsG: 40, proteinG: 30 });
  });
  it("refuses an MFP file with no carbohydrates column", () => {
    expect(bad(parseNutritionHistory("Date,Meal,Calories,Fat (g),Protein (g)\n2026-07-05,Lunch,500,20,30", { todayKey: TODAY }))).toContain("MyFitnessPal export, but it has no Carbs column");
  });
});

describe("MacroFactor food log (headers not confirmed)", () => {
  const MF = ["Date,Time,Food Name,Serving Size,Serving Unit,Calories (kcal),Protein (g),Fat (g),Carbs (g),Fiber (g)", "2026-10-01,08:00,Eggs,2,large,140,12,10,1,0", "2026-10-01,12:30,\"Rice, white\",1,cup,205,4.3,0.4,45,0.6"].join("\n");

  it("reads the foods, and names MacroFactor only when the file says so", () => {
    const named = ok(parseNutritionHistory(MF, { todayKey: TODAY, fileName: "MacroFactor-export.csv" }));
    expect(named.source).toBe("macrofactor");
    expect(named.sourceLabel).toBe("MacroFactor");
    expect(named.rows[1]).toEqual({ date: "2026-10-01", mealSlot: null, description: "Rice, white", servingLabel: "1 cup", calories: 205, proteinG: 4.3, carbsG: 45, fatG: 0.4 });
    expect(ok(parseNutritionHistory(MF, { todayKey: TODAY, fileName: "export.csv" })).sourceLabel).toBe("a food log");
  });
  it("refuses a food file missing a macro column instead of guessing", () => {
    expect(bad(parseNutritionHistory("Date,Food Name,Calories,Protein\n2026-10-01,Eggs,140,12", { todayKey: TODAY }))).toContain("no Carbs or Fat column");
  });
});

describe("files that are not recognized", () => {
  it("refuses a file it cannot place, and saves nothing", () => {
    expect(bad(parseNutritionHistory("Date,Exercise,Weight,Reps\n2026-10-01,Squat,225,5", { todayKey: TODAY }))).toBe(UNRECOGNIZED_FILE);
    expect(bad(parseNutritionHistory("", { todayKey: TODAY }))).toContain("empty");
    expect(bad(parseNutritionHistory("Day,Food Name,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n", { todayKey: TODAY }))).toContain("no rows");
  });
  it("detects nothing from a header with none of the names", () => {
    expect("error" in detectHistoryFormat(["foo", "bar"])).toBe(true);
  });
});

describe("dates", () => {
  it("reads year-month-day, with a time after it", () => {
    expect(parseDateCell("2026-08-03", null)).toBe("2026-08-03");
    expect(parseDateCell("2026-8-3 07:15:00", null)).toBe("2026-08-03");
    expect(parseDateCell("2026-02-30", null)).toBeNull();
    expect(parseDateCell("Aug 3", null)).toBeNull();
  });
  it("works out month/day or day/month from the whole file, and never guesses", () => {
    expect(slashedDateOrder(["8/3/2026", "8/14/2026"])).toBe("mdy");
    expect(slashedDateOrder(["3/8/2026", "14/8/2026"])).toBe("dmy");
    expect(slashedDateOrder(["8/3/2026", "8/4/2026"])).toBe("unclear");
    expect(slashedDateOrder(["2026-08-03"])).toBe("none");
    expect(parseDateCell("8/14/2026", "mdy")).toBe("2026-08-14");
    expect(parseDateCell("14/8/2026", "dmy")).toBe("2026-08-14");
  });
  it("refuses a file whose slashed dates could be either way", () => {
    const err = bad(parseNutritionHistory("Date,Meal,Calories,Fat,Carbs,Protein\n8/3/2026,Lunch,500,20,40,30\n8/4/2026,Lunch,500,20,40,30", { todayKey: TODAY }));
    expect(err).toContain("won't guess");
  });
  it("leaves out today and later (counted, not listed), and refuses a file of only those", () => {
    const csv = "Day,Group,Food Name,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n2026-11-08,Lunch,Rice,200,4,44,0\n2026-11-09,Lunch,Rice,200,4,44,0\n2026-11-10,Lunch,Rice,200,4,44,0";
    const p = ok(parseNutritionHistory(csv, { todayKey: TODAY }));
    expect(p.rows.map((r) => r.date)).toEqual(["2026-11-08"]);
    expect(p.leftOutFromToday).toBe(2);
    expect(p.skipped).toEqual([]);
    expect(bad(parseNutritionHistory(csv, { todayKey: "2026-11-08" }))).toContain("today or later");
  });
  it("refuses more than 2 years, naming the range", () => {
    const csv = "Day,Group,Food Name,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n2023-01-01,Lunch,Rice,200,4,44,0\n2026-01-05,Lunch,Rice,200,4,44,0";
    expect(bad(parseNutritionHistory(csv, { todayKey: TODAY }))).toContain("Jan 1, 2023 to Jan 5, 2026, which is more than 2 years");
  });
});

describe("rows that are not read", () => {
  it("skips a row with an unreadable or too-large number, a missing date or name, and says which row", () => {
    const csv = [
      "Day,Group,Food Name,Energy (kcal),Protein (g),Carbs (g),Fat (g)",
      "2026-09-01,Lunch,Rice,abc,4,44,0",
      "2026-09-01,Lunch,Pizza,25000,4,44,0",
      "2026-09-01,Lunch,Oops,-5,4,44,0",
      ",Lunch,Beans,100,7,18,0",
      "2026-09-01,Lunch,,100,7,18,0",
      "not a date,Lunch,Corn,100,3,20,1",
      "2026-09-01,Dinner,Water,0,,,",
      "2026-09-01,Dinner,Steak,\"1,050\",80,0,75",
    ].join("\n");
    const p = ok(parseNutritionHistory(csv, { todayKey: TODAY }));
    expect(p.skipped).toEqual([
      { rowNumber: 2, reason: "a number that isn't readable" },
      { rowNumber: 3, reason: "a number too large (or below zero) for one entry" },
      { rowNumber: 4, reason: "a number too large (or below zero) for one entry" },
      { rowNumber: 5, reason: "no date" },
      { rowNumber: 6, reason: "no food name" },
      { rowNumber: 7, reason: "a date that isn't readable" },
    ]);
    expect(p.rows).toEqual([
      { date: "2026-09-01", mealSlot: "dinner", description: "Water", servingLabel: null, calories: 0, proteinG: null, carbsG: null, fatG: null },
      { date: "2026-09-01", mealSlot: "dinner", description: "Steak", servingLabel: null, calories: 1050, proteinG: 80, carbsG: 0, fatG: 75 },
    ]);
  });
  it("shortens a very long food name to what the app stores", () => {
    const long = "x".repeat(400);
    const p = ok(parseNutritionHistory(`Day,Food Name,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n2026-09-01,${long},1,1,1,1`, { todayKey: TODAY }));
    expect(p.rows[0].description.length).toBe(160);
  });
  it("refuses a file over the row cap with a plain message", () => {
    const lines = ["Day,Food Name,Energy (kcal),Protein (g),Carbs (g),Fat (g)"];
    for (let i = 0; i < IMPORT_MAX_ROWS + 1; i++) lines.push(`2026-09-01,Rice,1,1,1,1`);
    expect(bad(parseNutritionHistory(lines.join("\n"), { todayKey: TODAY }))).toContain("Up to 20,000 can be brought in at once");
  });
});

describe("small pieces", () => {
  it("numbers", () => {
    expect(parseNumberCell("")).toEqual({ value: null, bad: false });
    expect(parseNumberCell(" 12.5 ")).toEqual({ value: 12.5, bad: false });
    expect(parseNumberCell("1,234.5")).toEqual({ value: 1234.5, bad: false });
    expect(parseNumberCell("12,5").bad).toBe(true);
    expect(parseNumberCell("12g").bad).toBe(true);
  });
  it("meals", () => {
    expect(mealSlotOf("Breakfast")).toBe("breakfast");
    expect(mealSlotOf(" SUPPER ")).toBe("dinner");
    expect(mealSlotOf("Afternoon Snack")).toBe("snack");
    expect(mealSlotOf("Uncategorized")).toBeNull();
    expect(mealSlotOf("")).toBeNull();
  });
  it("Cronometer total rows", () => {
    expect(isCronometerTotalRow("Total", "")).toBe(true);
    expect(isCronometerTotalRow("Daily Total", "Total")).toBe(true);
    expect(isCronometerTotalRow("Total", "Protein Shake")).toBe(false);
    expect(isCronometerTotalRow("Lunch", "")).toBe(false);
  });
  it("the sample line and the preview line", () => {
    const row: ImportedFoodRow = { date: "2026-08-03", mealSlot: "breakfast", description: "Oatmeal", servingLabel: "1.00 cup", calories: 307.2, proteinG: 10.7, carbsG: 54.8, fatG: 5.3 };
    expect(sampleLine(row)).toBe("Aug 3 · Breakfast · Oatmeal, 1.00 cup · 307 cal · 11 P / 55 C / 5 F");
    expect(sampleLine({ ...row, mealSlot: null, servingLabel: null, proteinG: null })).toBe("Aug 3 · Oatmeal · 307 cal · – P / 55 C / 5 F");
    const one = { dayCount: 1, firstDate: "2025-12-31", lastDate: "2025-12-31", rows: [row], rowWord: { one: "food", many: "foods" } };
    expect(previewLine(one, TODAY)).toBe("Found 1 day, Dec 31, 2025 · 1 food");
  });
});

describe("sending in pieces of whole days", () => {
  const day = (date: string, n: number): ImportedFoodRow[] => Array.from({ length: n }, () => ({ date, mealSlot: null, description: "f", servingLabel: null, calories: 1, proteinG: 1, carbsG: 1, fatG: 1 }));
  it("never splits a day, and keeps each piece under the size unless one day is bigger", () => {
    const rows = [...day("2026-01-01", 3), ...day("2026-01-02", 3), ...day("2026-01-03", 9), ...day("2026-01-04", 1)];
    const chunks = chunkByDay(rows, 5);
    expect(chunks.map((c) => c.length)).toEqual([3, 3, 9, 1]);
    expect(chunkByDay(rows, 7).map((c) => c.length)).toEqual([6, 9, 1]);
    expect(chunks.flat()).toEqual(rows);
    for (const c of chunks) expect(new Set(c.map((r) => r.date)).size).toBeGreaterThan(0);
  });
});

describe("the server's check of each row it is sent", () => {
  const good = { date: "2026-08-03", mealSlot: "breakfast", description: "Oatmeal", servingLabel: "1 cup", calories: 300, proteinG: 10, carbsG: 50, fatG: 5 };
  it("accepts a valid row, and a row with no numbers", () => {
    expect(checkImportRow(good)).toEqual(good);
    expect(checkImportRow({ date: "2026-08-03", description: "Water" })).toEqual({ date: "2026-08-03", mealSlot: null, description: "Water", servingLabel: null, calories: null, proteinG: null, carbsG: null, fatG: null });
  });
  it("refuses anything else", () => {
    for (const r of [
      null,
      "x",
      { ...good, date: "2026-02-30" },
      { ...good, date: "8/3/2026" },
      { ...good, date: "1999-12-31" },
      { ...good, mealSlot: "brunch" },
      { ...good, description: "" },
      { ...good, description: "x".repeat(161) },
      { ...good, servingLabel: "x".repeat(121) },
      { ...good, calories: -1 },
      { ...good, calories: 20001 },
      { ...good, proteinG: "10" },
      { ...good, fatG: Number.NaN },
    ]) {
      expect(checkImportRow(r)).toBeNull();
    }
  });
});
