import { describe, it, expect } from "vitest";
import { parseOpenFoodFactsResponse } from "./open-food-facts";

describe("parseOpenFoodFactsResponse", () => {
  it("returns null when the product wasn't found", () => {
    expect(parseOpenFoodFactsResponse({ status: 0 })).toBeNull();
  });

  it("prefers per-serving figures when the product declares a serving size", () => {
    const result = parseOpenFoodFactsResponse({
      status: 1,
      product: {
        product_name: "Protein Bar",
        serving_size: "60g",
        nutriments: {
          "energy-kcal_100g": 400,
          "energy-kcal_serving": 240,
          proteins_100g: 33,
          proteins_serving: 20,
          carbohydrates_100g: 40,
          carbohydrates_serving: 24,
          fat_100g: 13,
          fat_serving: 8,
        },
      },
    });
    expect(result).toEqual({
      description: "Protein Bar",
      calories: 240,
      proteinG: 20,
      carbsG: 24,
      fatG: 8,
      basis: "serving",
    });
  });

  it("falls back to per-100g when no serving size is declared", () => {
    const result = parseOpenFoodFactsResponse({
      status: 1,
      product: {
        product_name: "Diet Soda",
        nutriments: {
          "energy-kcal_100g": 0,
          proteins_100g: 0,
          carbohydrates_100g: 0,
          fat_100g: 0,
        },
      },
    });
    expect(result?.basis).toBe("100g");
    expect(result?.calories).toBe(0);
  });

  it("prefixes the brand onto the description when it isn't already in the name", () => {
    const result = parseOpenFoodFactsResponse({
      status: 1,
      product: {
        product_name: "Diet Coke Soft Drink",
        brands: "Coca-Cola",
        nutriments: { "energy-kcal_100g": 0, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0 },
      },
    });
    expect(result?.description).toBe("Coca-Cola Diet Coke Soft Drink");
  });

  it("returns null when nutriment values are missing or non-numeric", () => {
    const result = parseOpenFoodFactsResponse({
      status: 1,
      product: { product_name: "Mystery Item", nutriments: {} },
    });
    expect(result).toBeNull();
  });
});
