import { describe, expect, it } from "vitest";
import { entryTooBigProblem } from "@/lib/food-validation";
import { customFoodEntryProblem, type CustomFood } from "@/lib/custom-food";
import { mealEntryProblem, type SavedMeal } from "@/lib/saved-meal";

const food: CustomFood = { id: "f", name: "Big bar", brand: null, servingLabel: "1 bar", servingG: 100, calories: 600, proteinG: 30, carbsG: 60, fatG: 20, nutrients: null, barcode: null };
const meal = (calories: number): SavedMeal => ({
  id: "m",
  name: "Dinner",
  items: [
    { position: 0, name: "Rice", servingLabel: null, servingQty: null, amountG: null, calories: 200, proteinG: 4, carbsG: 45, fatG: 1, nutrients: null, foodSource: null, fdcId: null },
    { position: 1, name: "Feast", servingLabel: null, servingQty: null, amountG: null, calories, proteinG: 10, carbsG: 10, fatG: 10, nutrients: null, foodSource: null, fdcId: null },
  ],
});

describe("entries that are too big to save are caught with a plain message", () => {
  it("names the number that is too big and says to check the servings", () => {
    expect(entryTooBigProblem({ calories: 12000, proteinG: 1, carbsG: 1, fatG: 1 })).toBe("That comes to 12,000 calories for one entry. Check the servings.");
    expect(entryTooBigProblem({ calories: 100, proteinG: 600, carbsG: 1, fatG: 1 })).toContain("600 g of protein");
    expect(entryTooBigProblem({ calories: 100, proteinG: 1, carbsG: 1200, fatG: 1 })).toContain("1,200 g of carbs");
    expect(entryTooBigProblem({ calories: 100, proteinG: 1, carbsG: 1, fatG: 700 })).toContain("700 g of fat");
  });
  it("exactly at the ceiling is fine", () => {
    expect(entryTooBigProblem({ calories: 6000, proteinG: 500, carbsG: 1000, fatG: 500 })).toBeNull();
  });
  it("a custom food: 100 servings of a 600-calorie bar is too big, 5 servings is not", () => {
    expect(customFoodEntryProblem(food, 100)).toContain("60,000 calories");
    expect(customFoodEntryProblem(food, 5)).toBeNull();
  });
  it("a saved meal: every food is checked before anything is saved, and the food is named", () => {
    expect(mealEntryProblem(meal(5000), 2)).toBe("Feast: That comes to 10,000 calories for one entry. Check the servings.");
    expect(mealEntryProblem(meal(500), 2)).toBeNull();
  });
});
