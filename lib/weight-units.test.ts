import { describe, it, expect } from "vitest";
import { MIXED_UNITS_REASON, parseWeightCell, planUnits, poundsFrom, unitFromText, weightInPounds } from "@/lib/weight-units";
import { detectHistoryColumns, headerUnitOf, parseHistoryRows } from "@/lib/history-import-parser";
import { parseFitprosExport } from "@/lib/fitpros-history";
import { IMPORT_UNITS_NOTE } from "@/lib/unclear-points";

describe("reading a unit from text", () => {
  it("headers and values that name a unit", () => {
    expect(unitFromText("Weight (kg)")).toBe("kg");
    expect(unitFromText("Weight (kgs)")).toBe("kg");
    expect(unitFromText("100kg")).toBe("kg");
    expect(unitFromText("100 KG")).toBe("kg");
    expect(unitFromText("Weight (lbs)")).toBe("lb");
    expect(unitFromText("220lb")).toBe("lb");
    expect(unitFromText("220 pounds")).toBe("lb");
    expect(unitFromText("Weight (kilograms)")).toBe("kg");
  });
  it("no unit, both units, or a word that only contains the letters, is no unit", () => {
    expect(unitFromText("Weight")).toBeNull();
    expect(unitFromText("225")).toBeNull();
    expect(unitFromText("Weight (lb/kg)")).toBeNull();
    expect(unitFromText("Skgs bulb")).toBeNull();
    expect(unitFromText("blbs")).toBeNull();
    expect(unitFromText(null)).toBeNull();
  });
});

describe("one weight cell", () => {
  it("the number and the unit written in it", () => {
    expect(parseWeightCell("100kg")).toEqual({ value: 100, unit: "kg" });
    expect(parseWeightCell("225")).toEqual({ value: 225, unit: null });
    expect(parseWeightCell(" 102.5 lb ")).toEqual({ value: 102.5, unit: "lb" });
    expect(parseWeightCell("1,200 lb")).toEqual({ value: 1200, unit: "lb" });
    expect(parseWeightCell("100,5 kg")).toEqual({ value: 100.5, unit: "kg" });
    expect(parseWeightCell("")).toEqual({ value: null, unit: null });
    expect(parseWeightCell("bodyweight")).toEqual({ value: null, unit: null });
  });
  it("kilograms become pounds, to one decimal; pounds are left alone", () => {
    expect(poundsFrom(100, "kg")).toBe(220.5);
    expect(poundsFrom(60, "kg")).toBe(132.3);
    expect(poundsFrom(102.5, "lb")).toBe(102.5);
    expect(poundsFrom(0, "kg")).toBe(0);
  });
});

describe("which unit a file is in", () => {
  it("the header wins, then the units written in the cells, then the coach's choice (pounds unless they picked kilograms)", () => {
    expect(planUnits({ headerUnit: "kg", cellUnits: [], chosen: "lb" })).toEqual({ unit: "kg", source: "header", mixed: false });
    expect(planUnits({ headerUnit: null, cellUnits: ["kg", "kg", null], chosen: "lb" })).toEqual({ unit: "kg", source: "cells", mixed: false });
    expect(planUnits({ headerUnit: null, cellUnits: [null, null], chosen: "kg" })).toEqual({ unit: "kg", source: "choice", mixed: false });
    expect(planUnits({ headerUnit: null, cellUnits: [], chosen: "lb" })).toEqual({ unit: "lb", source: "choice", mixed: false });
  });
  it("a file that mixes units is mixed; an even split falls back to the choice and is still mixed", () => {
    expect(planUnits({ headerUnit: null, cellUnits: ["kg", "kg", "lb"], chosen: "lb" })).toEqual({ unit: "kg", source: "cells", mixed: true });
    expect(planUnits({ headerUnit: "lb", cellUnits: ["kg"], chosen: "lb" }).mixed).toBe(true);
    expect(planUnits({ headerUnit: null, cellUnits: ["kg", "lb"], chosen: "lb" })).toEqual({ unit: "lb", source: "choice", mixed: true });
  });
  it("a row that names a different unit than the file is converted by what it says but flagged", () => {
    const plan = planUnits({ headerUnit: "kg", cellUnits: [], chosen: "lb" });
    expect(weightInPounds({ value: 100, unit: null }, plan)).toEqual({ pounds: 220.5, unclearReason: null });
    expect(weightInPounds({ value: 100, unit: "kg" }, plan)).toEqual({ pounds: 220.5, unclearReason: null });
    expect(weightInPounds({ value: 225, unit: "lb" }, plan)).toEqual({ pounds: 225, unclearReason: MIXED_UNITS_REASON });
    expect(weightInPounds({ value: null, unit: "lb" }, plan)).toEqual({ pounds: null, unclearReason: null });
  });
});

describe("a spreadsheet of history", () => {
  const header = ["Date", "Exercise", "Weight (kg)", "Reps"];
  const rows = [
    ["2026-08-01", "Squat", "100", "5"],
    ["2026-08-02", "Squat", "102.5", "5"],
  ];
  it("a kilogram header converts every weight to pounds and says so", () => {
    const mapping = detectHistoryColumns(header);
    const result = parseHistoryRows(rows, mapping, { headerUnit: headerUnitOf(header, mapping) });
    expect(result.rows.map((r) => r.weight)).toEqual([220.5, 226]);
    expect(result.units).toEqual({ unit: "kg", source: "header", mixed: false });
    expect(result.rows.some((r) => r.unclearReason)).toBe(false);
  });
  it("no unit anywhere: pounds by default, kilograms when the coach chose them before uploading", () => {
    const plain = [["Date", "Exercise", "Weight", "Reps"], ...rows];
    const mapping = detectHistoryColumns(plain[0]);
    expect(parseHistoryRows(rows, mapping).rows.map((r) => r.weight)).toEqual([100, 102.5]);
    expect(parseHistoryRows(rows, mapping, { chosenUnit: "kg" }).rows.map((r) => r.weight)).toEqual([220.5, 226]);
  });
  it("units written in the cells are read: 100kg and 220lb", () => {
    const mapping = detectHistoryColumns(["Date", "Exercise", "Weight", "Reps"]);
    const result = parseHistoryRows([["2026-08-01", "Squat", "100kg", "5"], ["2026-08-02", "Squat", "105kg", "5"]], mapping);
    expect(result.rows.map((r) => r.weight)).toEqual([220.5, 231.5]);
    expect(result.units.source).toBe("cells");
  });
  it("a file that mixes units: the odd rows are flagged, none is guessed silently", () => {
    const mapping = detectHistoryColumns(["Date", "Exercise", "Weight", "Reps"]);
    const result = parseHistoryRows(
      [
        ["2026-08-01", "Squat", "100kg", "5"],
        ["2026-08-02", "Squat", "105kg", "5"],
        ["2026-08-03", "Squat", "225lb", "5"],
        ["2026-08-04", "Squat", "110", "5"],
      ],
      mapping
    );
    expect(result.units.mixed).toBe(true);
    expect(result.rows.map((r) => [r.weight, r.unclearReason ?? null])).toEqual([
      [220.5, null],
      [231.5, null],
      [225, MIXED_UNITS_REASON],
      [242.5, null], // no unit written: read in the file's unit (kilograms)
    ]);
  });
});

describe("a FitPros file", () => {
  const text = "## 2026-08-17 | Day 1\nSquat | 5,5 | 100kg,102.5kg\nBench | 5 | 225lb\n";
  it("lb or kg after each weight is read; the odd one out is flagged", () => {
    const { workouts } = parseFitprosExport(text);
    const [squat, bench] = workouts[0].exercises;
    expect(squat.sets.map((s) => s.weight)).toEqual([220.5, 226]);
    expect(bench.sets[0].weight).toBe(225);
    expect(bench.sets[0].unclearReason).toBe(MIXED_UNITS_REASON);
    expect(squat.sets.some((s) => s.unclearReason)).toBe(false);
    expect(workouts[0].flags.some((f) => f.includes("different unit"))).toBe(true);
    // nothing about the unit is left on the sets the importer writes
    expect("weightUnit" in squat.sets[0]).toBe(false);
  });
  it("a file with no unit written is read as pounds, or as kilograms when the coach chose so", () => {
    const bare = "## 2026-08-17 | Day 1\nSquat | 5,5 | 205,205\n";
    expect(parseFitprosExport(bare).workouts[0].exercises[0].sets.map((s) => s.weight)).toEqual([205, 205]);
    expect(parseFitprosExport(bare, "kg").workouts[0].exercises[0].sets.map((s) => s.weight)).toEqual([451.9, 451.9]);
  });
});

describe("the note on the page", () => {
  it("says weights are read as pounds unless the file says otherwise or kilograms are chosen", () => {
    expect(IMPORT_UNITS_NOTE).toBe("Weights are read in the unit the file says. If it does not say, they are read as pounds unless you choose kilograms; kilograms are converted to pounds when saved.");
  });
});
