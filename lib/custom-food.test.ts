import { describe, expect, it } from "vitest";
import { checkCustomFood, customFoodEntryRow, customFoodFromRow, customFoodInsertRow, customFoodTitle, emptyCustomFoodForm, perServingNutrients, servingsProblem, type CustomFood } from "@/lib/custom-food";

const form = (patch: Partial<ReturnType<typeof emptyCustomFoodForm>> = {}) => ({ ...emptyCustomFoodForm(), name: "Peanut crunch bar", brand: "Acme", servingLabel: "1 bar", servingG: "60", calories: "230", protein: "20", carbs: "22", fat: "8", ...patch });

describe("checkCustomFood", () => {
  it("accepts a normal label and builds the food to save", () => {
    const r = checkCustomFood(form({ label: { fiber_g: "5", sodium_mg: "190" }, barcode: "0123456789012" }));
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({ name: "Peanut crunch bar", brand: "Acme", servingLabel: "1 bar", servingG: 60, calories: 230, proteinG: 20, carbsG: 22, fatG: 8, nutrients: { fiber_g: 5, sodium_mg: 190 }, barcode: "0123456789012" });
  });
  it("needs a name, a serving and calories", () => {
    expect(checkCustomFood(form({ name: " " })).errors).toContain("Give the food a name.");
    expect(checkCustomFood(form({ servingLabel: "" })).errors[0]).toContain("what one serving is");
    expect(checkCustomFood(form({ calories: "" })).errors).toContain("Enter the calories.");
  });
  it("macros and the weight may be left empty (they count as zero or unknown)", () => {
    const r = checkCustomFood(form({ protein: "", carbs: "", fat: "", servingG: "", calories: "100" }));
    expect(r.errors).toEqual([]);
    expect(r.value).toMatchObject({ proteinG: 0, carbsG: 0, fatG: 0, servingG: null });
  });
  it("refuses absurd and negative values", () => {
    expect(checkCustomFood(form({ calories: "90000" })).errors.join(" ")).toContain("calories");
    expect(checkCustomFood(form({ protein: "-4" })).errors).toContain("Numbers can't be negative.");
    expect(checkCustomFood(form({ servingG: "9000" })).errors[0]).toContain("serving weight");
    expect(checkCustomFood(form({ label: { sodium_mg: "999999" } })).errors[0]).toContain("Sodium is more than 20,000 mg");
    expect(checkCustomFood(form({ label: { fiber_g: "abc" } })).errors).toContain("Fiber: use numbers only.");
  });
  it("warns, without blocking, when calories and macros do not add up, or the label contradicts itself", () => {
    const off = checkCustomFood(form({ calories: "900" }));
    expect(off.errors).toEqual([]);
    expect(off.warnings[0]).toContain("don't quite add up");
    expect(off.value).not.toBeNull();
    const sat = checkCustomFood(form({ label: { sat_fat_g: "12" } }));
    expect(sat.warnings).toContain("Saturated fat is more than the total fat. Check the label.");
    expect(checkCustomFood(form({ label: { sugar_g: "40" } })).warnings).toContain("Sugar is more than the total carbs. Check the label.");
  });
  it("a barcode is digits only", () => {
    expect(checkCustomFood(form({ barcode: "12ab" })).errors[0]).toContain("numbers only");
    expect(checkCustomFood(form({ barcode: "" })).value?.barcode).toBeNull();
  });
});

describe("rows", () => {
  const food: CustomFood = { id: "f1", name: "Peanut crunch bar", brand: "Acme", servingLabel: "1 bar", servingG: 60, calories: 230, proteinG: 20, carbsG: 22, fatG: 8, nutrients: { fiber_g: 5 }, barcode: "0123456789012" };
  it("maps to and from the database row", () => {
    const { id, ...rest } = food;
    void id;
    expect(customFoodInsertRow("a1", rest)).toMatchObject({ athlete_id: "a1", serving_label: "1 bar", serving_g: 60, protein_g: 20, barcode: "0123456789012" });
    expect(customFoodFromRow({ id: "f1", name: "x", brand: null, serving_label: "1", serving_g: "60", calories: "230", protein_g: "20", carbs_g: "22", fat_g: "8", nutrients: null, barcode: null })).toMatchObject({ servingG: 60, calories: 230 });
  });
  it("titles a food with its brand once", () => {
    expect(customFoodTitle(food)).toBe("Acme Peanut crunch bar");
    expect(customFoodTitle({ name: "Acme bar", brand: "Acme" })).toBe("Acme bar");
  });
  it("all the nutrients of one serving include the macros under the USDA keys", () => {
    expect(perServingNutrients(food)).toEqual({ fiber_g: 5, kcal: 230, protein_g: 20, carbs_g: 22, fat_g: 8 });
  });
  it("logging 1.5 servings scales every number and the weight", () => {
    const row = customFoodEntryRow({ athleteId: "a1", groupId: "g1", logDate: "2026-10-08", mealSlot: "snack", food, qty: 1.5 });
    expect(row).toMatchObject({ description: "Acme Peanut crunch bar", calories: 345, protein_g: 30, carbs_g: 33, fat_g: 12, food_source: "custom", amount_g: 90, serving_label: "1 bar", serving_qty: 1.5, meal_slot: "snack", barcode: "0123456789012" });
    expect(row.nutrients).toEqual({ fiber_g: 7.5, kcal: 345, protein_g: 30, carbs_g: 33, fat_g: 12 });
  });
  it("a food with no weight logs without one", () => {
    expect(customFoodEntryRow({ athleteId: "a1", groupId: "g1", logDate: "d", mealSlot: null, food: { ...food, servingG: null }, qty: 1 }).amount_g).toBeNull();
  });
});

describe("servingsProblem", () => {
  it("accepts a sane number of servings", () => {
    expect(servingsProblem(0.5)).toBeNull();
    expect(servingsProblem(0)).not.toBeNull();
    expect(servingsProblem(500)).toContain("100 servings");
  });
});
