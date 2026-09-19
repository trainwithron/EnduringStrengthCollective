import { describe, it, expect } from "vitest";
import {
  parseIngredientLine,
  normalizeFoodName,
  scoreFoodMatch,
  pickBestFoodMatch,
  pickSearchTerm,
  MIN_CONFIDENT_MATCH_SCORE,
} from "./food-matching";

describe("parseIngredientLine", () => {
  it("parses a real AI-style ingredient line", () => {
    expect(parseIngredientLine("Chicken Breast: 170g (~6.0 oz)")).toEqual({ name: "Chicken Breast", grams: 170 });
  });

  it("parses a plain line with no trailing note", () => {
    expect(parseIngredientLine("Brown Rice: 90g")).toEqual({ name: "Brown Rice", grams: 90 });
  });

  it("parses a decimal gram amount", () => {
    expect(parseIngredientLine("Olive Oil: 13.5g")).toEqual({ name: "Olive Oil", grams: 13.5 });
  });

  it("returns null when there's no gram amount", () => {
    expect(parseIngredientLine("A pinch of salt")).toBeNull();
  });

  it("returns null for a zero or negative amount", () => {
    expect(parseIngredientLine("Ghost Ingredient: 0g")).toBeNull();
  });

  it("returns null for an empty name", () => {
    expect(parseIngredientLine(": 100g")).toBeNull();
  });
});

describe("normalizeFoodName", () => {
  it("lowercases, strips punctuation, and drops stopwords", () => {
    expect(normalizeFoodName("Chicken Breast, Raw")).toBe("breast chicken");
  });

  it("is order-independent", () => {
    expect(normalizeFoodName("Breast, Chicken")).toBe(normalizeFoodName("Chicken Breast"));
  });
});

describe("scoreFoodMatch", () => {
  it("scores an exact match at 1", () => {
    expect(scoreFoodMatch("Chicken Breast", "Chicken Breast")).toBe(1);
  });

  it("scores a real USDA-style description reasonably high", () => {
    const score = scoreFoodMatch("Chicken Breast", "Chicken, broilers or fryers, breast, meat only, raw");
    expect(score).toBeGreaterThan(0.15);
  });

  it("scores two unrelated foods low", () => {
    expect(scoreFoodMatch("Chicken Breast", "Broccoli, raw")).toBeLessThan(MIN_CONFIDENT_MATCH_SCORE);
  });
});

describe("pickBestFoodMatch", () => {
  const candidates = [
    { fdcId: 1, description: "Chicken, broilers or fryers, breast, meat only, raw" },
    { fdcId: 2, description: "Broccoli, raw" },
    { fdcId: 3, description: "Chicken, broilers or fryers, breast, meat only, cooked, roasted" },
  ];

  it("picks the highest-scoring confident candidate", () => {
    const result = pickBestFoodMatch("Chicken Breast", candidates);
    expect(result).not.toBeNull();
    expect([1, 3]).toContain(result!.fdcId);
    expect(result!.score).toBeGreaterThanOrEqual(MIN_CONFIDENT_MATCH_SCORE);
  });

  it("returns null when nothing clears the confidence bar", () => {
    const result = pickBestFoodMatch("Quinoa", [{ fdcId: 2, description: "Broccoli, raw" }]);
    expect(result).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(pickBestFoodMatch("Chicken Breast", [])).toBeNull();
  });
});

describe("pickSearchTerm", () => {
  it("picks the longest normalized word as the broad search term", () => {
    expect(pickSearchTerm("Chicken Breast")).toBe("chicken");
    expect(pickSearchTerm("Brown Rice")).toBe("brown");
  });

  it("falls back to the trimmed raw name when nothing normalizes", () => {
    expect(pickSearchTerm("   ")).toBe("");
  });
});
