import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { quickAddEntry } from "./quick-add-numbers";

const blank = { name: "", calories: "", protein: "", carbs: "", fat: "" };

describe("Just the numbers", () => {
  it("saves what was typed, named Quick add when no name is given, an empty field staying empty", () => {
    expect(quickAddEntry({ ...blank, calories: "450", protein: "30" })).toEqual({ entry: { description: "Quick add", calories: 450, proteinG: 30, carbsG: null, fatG: null } });
    expect(quickAddEntry({ name: "  Protein bar ", calories: "210", protein: "20", carbs: "22", fat: "7.5" })).toEqual({ entry: { description: "Protein bar", calories: 210, proteinG: 20, carbsG: 22, fatG: 7.5 } });
  });
  it("one macro alone is enough; 0 is a number", () => {
    expect("entry" in quickAddEntry({ ...blank, protein: "25" })).toBe(true);
    expect(quickAddEntry({ ...blank, calories: "0" })).toEqual({ entry: { description: "Quick add", calories: 0, proteinG: null, carbsG: null, fatG: null } });
  });
  it("refuses nothing typed, negatives, words and a number too big for one entry", () => {
    expect(quickAddEntry(blank)).toEqual({ problem: "Enter the calories or at least one of protein, carbs or fat." });
    expect(quickAddEntry({ ...blank, calories: "-5" })).toEqual({ problem: "Numbers can't be negative." });
    expect(quickAddEntry({ ...blank, carbs: "lots" })).toEqual({ problem: "Use numbers only." });
    expect(quickAddEntry({ ...blank, calories: "9000" })).toEqual({ problem: "That comes to 9,000 calories for one entry. Check the number." });
  });
  it("is one plain logged food in the meal for the time of day, inside Log something else", () => {
    const src = readFileSync(join(__dirname, "..", "components/athlete/quick-log-food-button.tsx"), "utf8").replace(/\r\n/g, "\n");
    const box = src.slice(src.indexOf("function JustTheNumbers"));
    expect(box).toContain("quickAddEntry({ name, calories, protein, carbs, fat })");
    expect(box).toContain("insertFoodLogEntry(createBrowserClient(), {");
    expect(box).toContain('status: "quick_log",');
    expect(box).toContain("mealSlot: defaultMealSlot(new Date().getHours(), new Date().getMinutes()),");
    expect(src).toContain("<JustTheNumbers");
    for (const label of ["Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Name (optional)"]) expect(box, label).toContain(label);
  });
});
