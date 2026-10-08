import { describe, expect, it } from "vitest";
import { checkMacros, parseNumberField } from "@/lib/food-validation";

describe("checkMacros", () => {
  it("accepts ordinary numbers", () => {
    expect(checkMacros({ calories: 250, proteinG: 20, carbsG: 25, fatG: 8 })).toEqual({ errors: [], warnings: [] });
  });
  it("needs calories, and no negatives", () => {
    expect(checkMacros({ calories: null, proteinG: 1, carbsG: 1, fatG: 1 }).errors).toContain("Enter the calories.");
    expect(checkMacros({ calories: -5, proteinG: 1, carbsG: 1, fatG: 1 }).errors).toContain("Numbers can't be negative.");
    expect(checkMacros({ calories: 100, proteinG: -1, carbsG: 1, fatG: 1 }).errors).toContain("Numbers can't be negative.");
  });
  it("refuses an absurd amount for one entry", () => {
    expect(checkMacros({ calories: 9000, proteinG: 10, carbsG: 10, fatG: 10 }).errors[0]).toContain("6,000 calories");
    expect(checkMacros({ calories: 500, proteinG: 900, carbsG: 0, fatG: 0 }).errors[0]).toContain("Protein");
    expect(checkMacros({ calories: 500, proteinG: 0, carbsG: 5000, fatG: 0 }).errors[0]).toContain("Carbs");
    expect(checkMacros({ calories: 500, proteinG: 0, carbsG: 0, fatG: 900 }).errors[0]).toContain("Fat");
  });
  it("warns, without refusing, when calories and macros do not add up (4/4/9)", () => {
    const r = checkMacros({ calories: 800, proteinG: 10, carbsG: 10, fatG: 5 });
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toContain("don't quite add up");
    expect(r.warnings[0]).toContain("about 125 calories");
  });
  it("does not warn about small rounding differences", () => {
    expect(checkMacros({ calories: 210, proteinG: 20, carbsG: 25, fatG: 3 }).warnings).toEqual([]);
  });
  it("does not check 4/4/9 when a macro is left empty", () => {
    expect(checkMacros({ calories: 800, proteinG: null, carbsG: 10, fatG: 5 }).warnings).toEqual([]);
  });
  it("warns about zero calories with macros", () => {
    expect(checkMacros({ calories: 0, proteinG: 5, carbsG: 0, fatG: 0 }).warnings.join(" ")).toContain("Zero calories");
  });
});

describe("parseNumberField", () => {
  it("parses numbers, allows commas, and tells empty from not-a-number", () => {
    expect(parseNumberField("12.5")).toBe(12.5);
    expect(parseNumberField("1,200")).toBe(1200);
    expect(parseNumberField("  ")).toBeNull();
    expect(Number.isNaN(parseNumberField("abc"))).toBe(true);
  });
});
