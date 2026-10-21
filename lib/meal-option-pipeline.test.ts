import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkMealOptions } from "./meal-option-pipeline";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const target = { proteinG: 40, carbsG: 60, fatG: 20 }; // 580 kcal
const line = (rawLine: string, matchedDescription: string | null = null) => ({ rawLine, matchedDescription });
const opt = (recipeName: string, lines: ReturnType<typeof line>[], p: number, c: number, f: number) => ({ recipeName, ingredients: lines, totalProtein: p, totalCarbs: c, totalFat: f, totalKcal: p * 4 + c * 4 + f * 9 });
const rules = { allergies: ["peanut"], intolerances: [], dislikes: [], dietType: "omnivore" };

const good = opt("Chicken and rice", [line("Chicken Breast: 170g", "Chicken, breast, roasted"), line("White Rice: 200g", "Rice, white, cooked")], 40, 60, 20);
const nutty = opt("Peanut noodles", [line("Peanut Butter: 40g", "Peanut butter, smooth"), line("Noodles: 150g", "Noodles, cooked")], 40, 60, 20);
const farOff = opt("Plain chicken", [line("Chicken Breast: 170g", "Chicken, breast, roasted")], 40, 5, 20);

describe("what happens to the AI's meal options before the coach sees them", () => {
  it("keeps an option that is safe and on target", () => {
    const r = checkMealOptions([good], rules, target);
    expect(r.options).toEqual([good]);
    expect(r.droppedForPreferences).toBe(0);
    expect(r.droppedForMacros).toBe(0);
  });

  it("an allergen option that MEETS the macros is still dropped, and counted as a food-rule drop", () => {
    const r = checkMealOptions([nutty, good], rules, target);
    expect(r.options).toEqual([good]);
    expect(r.droppedForPreferences).toBe(1);
    expect(r.droppedForMacros).toBe(0);
  });

  it("a safe option that is far off the target is dropped, and the count is returned", () => {
    const r = checkMealOptions([farOff, good], rules, target);
    expect(r.options).toEqual([good]);
    expect(r.droppedForMacros).toBe(1);
    expect(r.droppedForPreferences).toBe(0);
  });

  it("an option is counted once, under the first check it failed: an allergen option that is also off target is a food-rule drop only", () => {
    const both = opt("Peanut snack", [line("Peanut Butter: 20g", "Peanut butter, smooth")], 10, 5, 10);
    const r = checkMealOptions([both, farOff], rules, target);
    expect(r.options).toEqual([]);
    expect(r.droppedForPreferences).toBe(1);
    expect(r.droppedForMacros).toBe(1);
  });

  it("with no food rules (a standalone tool) only the numbers decide", () => {
    const r = checkMealOptions([nutty, farOff], null, target);
    expect(r.options).toEqual([nutty]);
    expect(r.droppedForMacros).toBe(1);
  });

  it("the real food an ingredient was matched to is checked too, not only the line the model wrote", () => {
    const sneaky = opt("Satay bowl", [line("Sauce: 40g", "Peanut sauce")], 40, 60, 20);
    const r = checkMealOptions([sneaky], rules, target);
    expect(r.options).toEqual([]);
    expect(r.droppedForPreferences).toBe(1);
  });
});

describe("how it is wired", () => {
  it("the route runs every verified option through it and returns both counts; the screen explains each empty answer, including a mix", () => {
    // the route calls the shared one-meal helper (lib/ai-meal-slot.ts, also used by the allergy rebuild), which runs the pipeline
    const route = src("app/api/ai/generate-meal-plan/route.ts");
    expect(route).toContain("await suggestMealSlotOptions(supabase, {");
    expect(src("lib/ai-meal-slot.ts")).toContain("return checkMealOptions(allVerified, req.rules,");
    expect(route).toContain("droppedForPreferences, droppedForMacros });");
    const screen = src("components/coach/desktop/meal-plan-generator.tsx");
    expect(screen).toContain("None of the suggestions landed close enough to this meal's macros");
    expect(screen).toContain("Some suggestions broke this client's food preferences and the rest didn't land close enough");
    expect(src("lib/meal-option-pipeline.ts").indexOf("filterOptionsByRules(")).toBeLessThan(src("lib/meal-option-pipeline.ts").indexOf("filterByMacroTolerance("));
  });
});
