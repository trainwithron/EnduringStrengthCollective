import { describe, expect, it } from "vitest";
import { mealProgress, mealProgressLine } from "./meal-progress";

const meals = ["breakfast", "lunch", "dinner", "snack"].map((id) => ({ spec: { id } }));

describe("mealProgress", () => {
  it("counts planned meals that have an entry, whatever the status", () => {
    expect(mealProgress(meals, [{ mealSlot: "breakfast" }, { mealSlot: "lunch" }])).toEqual({ logged: 2, total: 4 });
  });
  it("counts a meal once however many entries it has", () => {
    expect(mealProgress(meals, [{ mealSlot: "breakfast" }, { mealSlot: "breakfast" }])).toEqual({ logged: 1, total: 4 });
  });
  it("ignores free-standing quick logs and slots that are not in the plan", () => {
    expect(mealProgress(meals, [{ mealSlot: null }, { mealSlot: "midnight" }])).toEqual({ logged: 0, total: 4 });
  });
  it("is null without a plan", () => {
    expect(mealProgress([], [{ mealSlot: "breakfast" }])).toBeNull();
  });
});

describe("mealProgressLine", () => {
  it("words it", () => {
    expect(mealProgressLine({ logged: 2, total: 4 })).toBe("Meals logged: 2 of 4");
    expect(mealProgressLine({ logged: 4, total: 4 })).toBe("All meals logged today");
    expect(mealProgressLine(null)).toBeNull();
  });
});
