import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { filterByMacroTolerance, targetKcal, withinMacroTolerance } from "./meal-option-tolerance";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const target = { proteinG: 40, carbsG: 60, fatG: 20 }; // 160 + 240 + 180 = 580 kcal
const opt = (totalProtein: number, totalCarbs: number, totalFat: number) => ({ totalProtein, totalCarbs, totalFat, totalKcal: totalProtein * 4 + totalCarbs * 4 + totalFat * 9 });

describe("is an AI meal option close enough to the meal's target", () => {
  it("accepts one that lands on or near the target", () => {
    expect(targetKcal(target)).toBe(580);
    expect(withinMacroTolerance(opt(40, 60, 20), target)).toBe(true);
    expect(withinMacroTolerance(opt(43, 56, 21), target)).toBe(true); // each within 10% / 4 g
  });

  it("refuses one that is short or over on any single macro", () => {
    expect(withinMacroTolerance(opt(40, 20, 20), target)).toBe(false); // 40 g of carbs short
    expect(withinMacroTolerance(opt(25, 60, 20), target)).toBe(false);
    expect(withinMacroTolerance(opt(40, 60, 35), target)).toBe(false);
    expect(withinMacroTolerance(opt(50, 60, 20), target)).toBe(false); // 10 g over on protein
  });

  it("refuses one whose calories are off even when each macro is just inside", () => {
    // protein +4, carbs +6, fat +4 (all inside their bands) but calories are 24 + 24 + 36 = 84 over
    expect(withinMacroTolerance(opt(44, 66, 24), target)).toBe(false);
  });

  it("does not hold a small target to a fraction of a gram", () => {
    const snack = { proteinG: 10, carbsG: 20, fatG: 5 };
    expect(withinMacroTolerance(opt(12, 22, 7), snack)).toBe(true);
    expect(withinMacroTolerance(opt(20, 22, 8), snack)).toBe(false);
  });

  it("a number that is not a number is never close enough", () => {
    expect(withinMacroTolerance({ totalProtein: NaN, totalCarbs: 60, totalFat: 20, totalKcal: 580 }, target)).toBe(false);
  });

  it("splits a batch into kept and dropped", () => {
    const { kept, dropped } = filterByMacroTolerance([opt(40, 60, 20), opt(40, 10, 20), opt(41, 58, 19)], target);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(1);
  });
});

describe("how it is wired", () => {
  it("the route holds every verified option to the target after the food-rule check, and says how many it dropped; the screen explains an empty answer", () => {
    const route = src("app/api/ai/generate-meal-plan/route.ts");
    expect(route).toContain("filterByMacroTolerance(");
    expect(route.indexOf("filterOptionsByRules(checked, rules)")).toBeLessThan(route.indexOf("filterByMacroTolerance("));
    expect(route).toContain("droppedForMacros");
    expect(src("components/coach/desktop/meal-plan-generator.tsx")).toContain("None of the suggestions landed close enough to this meal's macros");
  });
});
