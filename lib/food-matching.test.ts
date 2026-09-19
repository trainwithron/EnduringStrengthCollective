import { describe, it, expect } from "vitest";
import {
  parseIngredientLine,
  normalizeFoodName,
  scoreFoodMatch,
  pickBestFoodMatch,
  significantWords,
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

  // Real mismatch found live: the AI writes "Eggs" (plural); a real USDA
  // description says "Egg, whole, raw, fresh" (singular) — same food,
  // zero word overlap without destemming.
  it("unifies a common singular/plural pair", () => {
    expect(normalizeFoodName("Eggs")).toBe(normalizeFoodName("Egg"));
  });

  it("leaves a short word alone rather than over-stripping it", () => {
    expect(normalizeFoodName("oz")).toBe("oz");
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

  // Real scaling bug found once the live table went from 2 rows to
  // 8,262: a compound/blended product containing all the query's words
  // ("Snacks, rice cakes, brown rice, sesame seed") must not beat a
  // plain, precise match ("Rice, brown, long-grain, cooked") just
  // because both technically contain "brown" and "rice".
  it("prefers the more precise candidate when two options both fully contain the query", () => {
    const result = pickBestFoodMatch("Brown Rice", [
      { fdcId: 10, description: "Snacks, rice cakes, brown rice, sesame seed" },
      { fdcId: 11, description: "Rice, brown, long-grain, cooked" },
    ]);
    expect(result?.fdcId).toBe(11);
  });

  // A generic ingredient name with no prep description conventionally
  // means the raw/uncooked form (how a recipe states an ingredient
  // before cooking) — a real scaling issue found once the live table
  // had many candidates: a processed product mentioning the same words
  // ("tenders, breaded, cooked, microwaved") shouldn't beat the plain
  // raw ingredient just because it happens to score the same containment.
  it("prefers a raw entry over an equally-containing processed one", () => {
    const result = pickBestFoodMatch("Chicken Breast", [
      { fdcId: 20, description: "Chicken breast tenders, breaded, cooked, microwaved" },
      { fdcId: 21, description: "Chicken, broilers or fryers, breast, meat only, raw" },
    ]);
    expect(result?.fdcId).toBe(21);
  });
});

describe("significantWords", () => {
  it("returns every normalized word, not just the longest one", () => {
    expect(significantWords("Chicken Breast")).toEqual(["breast", "chicken"]);
    expect(significantWords("Brown Rice")).toEqual(["brown", "rice"]);
  });

  it("returns an empty array for a name with nothing left after normalizing", () => {
    expect(significantWords("   ")).toEqual([]);
  });
});
