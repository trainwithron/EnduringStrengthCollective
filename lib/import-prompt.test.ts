import { describe, it, expect } from "vitest";
import { buildImportPrompt, IMPORT_PROMPT_HEADERS, IMPORT_PROMPT_EXAMPLE_ROWS } from "@/lib/import-prompt";
import { detectColumns, parseImportRows } from "@/lib/workout-import-parser";

describe("the copy-this-prompt helper", () => {
  const prompt = buildImportPrompt();
  it("asks for exactly the columns the free importer reads", () => {
    expect(IMPORT_PROMPT_HEADERS).toEqual(["Week", "Day", "Exercise", "Sets", "Reps", "Weight", "RPE", "Rest"]);
    expect(prompt).toContain("Week,Day,Exercise,Sets,Reps,Weight,RPE,Rest");
  });
  it("tells the other AI the rules that matter: one row per exercise, names as written, CSV only", () => {
    expect(prompt).toMatch(/One row per exercise per day/);
    expect(prompt).toMatch(/exactly as written/);
    expect(prompt).toMatch(/Output only the CSV/);
    expect(prompt).toContain("[paste or attach it here]");
  });
  it("its own example reads back through the real importer without any AI", () => {
    const header = IMPORT_PROMPT_HEADERS;
    const mapping = detectColumns(header);
    expect(mapping.exercise).toBe(2);
    expect(mapping.sets).toBe(3);
    expect(mapping.rpe).toBe(6);
    const rows = parseImportRows(IMPORT_PROMPT_EXAMPLE_ROWS.map((r) => r.split(",")), mapping);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ week: "Week 1", day: "Day 1", exerciseName: "Back Squat", sets: 3, reps: "5", weight: 225, rpe: 8 });
    expect(rows[2]).toMatchObject({ day: "Day 2", exerciseName: "Bench Press", sets: 4 });
  });
});
