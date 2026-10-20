import { describe, it, expect } from "vitest";
import { dedupeRecentFoodLogs, withJustLogged } from "./recent-food-logs";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";

function entry(description: string, more: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return { id: description || "x", mealSlot: "lunch", status: "quick_log", description, calories: 400, proteinG: 30, carbsG: 40, fatG: 10, ...more };
}

describe("dedupeRecentFoodLogs", () => {
  it("keeps only the most recent instance of a repeated description", () => {
    const result = dedupeRecentFoodLogs([entry("Chipotle bowl", { id: "new" }), entry("Chipotle bowl", { id: "old" })], 10);
    expect(result).toHaveLength(1);
    expect(result[0].entry.id).toBe("new");
    expect(result[0].label).toBe("Chipotle bowl");
  });

  it("treats descriptions as equal case/whitespace-insensitively", () => {
    expect(dedupeRecentFoodLogs([entry("Chipotle Bowl"), entry(" chipotle bowl ")], 10)).toHaveLength(1);
  });

  it("respects the limit", () => {
    expect(dedupeRecentFoodLogs(["a", "b", "c", "d"].map((d) => entry(d)), 2)).toHaveLength(2);
  });

  it("skips empty descriptions and skipped meals", () => {
    const result = dedupeRecentFoodLogs([entry(""), entry("Skipped lunch", { status: "skipped" }), entry("real meal")], 10);
    expect(result.map((r) => r.key)).toEqual(["real meal"]);
  });

  it("keeps the whole food: its nutrients, serving and amount, and says the serving on the chip", () => {
    const yogurt = entry("Greek yogurt", { servingLabel: "cup", servingQty: 1, amountG: 227, nutrients: { calcium_mg: 250 }, foodSource: "usda", fdcId: 123 });
    const [r] = dedupeRecentFoodLogs([yogurt], 8);
    expect(r.entry).toBe(yogurt);
    expect(r.entry.nutrients).toEqual({ calcium_mg: 250 });
    expect(r.entry.servingLabel).toBe("cup");
    expect(r.entry.amountG).toBe(227);
    expect(r.label).toBe("Greek yogurt · 1 x cup (227 g (8 oz))");
  });
});

describe("withJustLogged", () => {
  it("puts the foods logged on this page first (newest first), still one chip per food, at most 8", () => {
    const saved = dedupeRecentFoodLogs(["a", "b", "c", "d", "e", "f", "g", "h"].map((d) => entry(d)), 8);
    const shown = withJustLogged([entry("toast"), entry("b")], saved);
    expect(shown.map((r) => r.key)).toEqual(["b", "toast", "a", "c", "d", "e", "f", "g"]);
  });
});
