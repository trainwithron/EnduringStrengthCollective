import { describe, expect, it } from "vitest";
import { completeness, formatNutrientAmount, panelRows } from "@/lib/nutrient-panel";

describe("panelRows", () => {
  it("lists the four macros then every tracked nutrient, with the amount or null for not reported", () => {
    const rows = panelRows({ kcal: 205, protein_g: 4.3, fiber_g: 0.6 });
    expect(rows.slice(0, 4).map((r) => r.key)).toEqual(["kcal", "protein_g", "carbs_g", "fat_g"]);
    expect(rows.find((r) => r.key === "kcal")?.amount).toBe(205);
    expect(rows.find((r) => r.key === "fiber_g")?.amount).toBe(0.6);
    // not reported is null, never zero
    expect(rows.find((r) => r.key === "carbs_g")?.amount).toBeNull();
    expect(rows.find((r) => r.key === "vitamin_d_mcg")?.amount).toBeNull();
    expect(rows).toHaveLength(16);
  });
  it("keeps a genuine zero as zero", () => {
    expect(panelRows({ sodium_mg: 0 }).find((r) => r.key === "sodium_mg")?.amount).toBe(0);
  });
});

describe("formatNutrientAmount", () => {
  it("rounds to what is readable", () => {
    expect(formatNutrientAmount(205.4)).toBe("205");
    expect(formatNutrientAmount(44.556)).toBe("44.6");
    expect(formatNutrientAmount(0.474)).toBe("0.47");
  });
});

describe("completeness", () => {
  it("counts the reported nutrients", () => {
    expect(completeness(panelRows({ kcal: 1, protein_g: 1 }))).toEqual({ reported: 2, total: 16 });
  });
});
