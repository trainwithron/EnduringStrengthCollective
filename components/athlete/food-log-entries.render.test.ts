import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/client", () => ({ createBrowserClient: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/" }));

import { FoodLogEntries } from "@/components/athlete/food-log-entries";
import { FoodSearchLog } from "@/components/athlete/food-search-log";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";

const rice: FoodLogEntry = {
  id: "e1", mealSlot: "lunch", status: "quick_log", description: "Rice, white, long-grain, cooked", calories: 308, proteinG: 6.4, carbsG: 66.8, fatG: 0.7,
  foodSource: "usda", fdcId: 1, amountG: 237, servingLabel: "1 cup", servingQty: 1.5, nutrients: { kcal: 308 },
};
const yogurt: FoodLogEntry = { id: "e2", mealSlot: null, status: "quick_log", description: "Greek yogurt", calories: 150, proteinG: 15, carbsG: 8, fatG: 4 };
const planned: FoodLogEntry = { id: "e3", mealSlot: "1", status: "ate_it", description: "Planned breakfast", calories: 500, proteinG: 40, carbsG: 50, fatG: 12 };

const render = (entries: FoodLogEntry[]) =>
  renderToStaticMarkup(createElement(FoodLogEntries, { athleteId: "a1", groupId: "g1", logDate: "2026-10-08", entries, onAdded() {}, onChanged() {}, onDeleted() {} }));

describe("FoodLogEntries", () => {
  it("lists free-form entries by meal, with the serving in both units, and edit and delete on each", () => {
    const html = render([rice, yogurt, planned]);
    expect(html).toContain("Lunch");
    expect(html).toContain("Other");
    expect(html).toContain("Rice, white, long-grain, cooked");
    expect(html).toContain("1.5 x 1 cup (237 g (8.4 oz))");
    expect(html).toContain("Greek yogurt");
    expect((html.match(/>Edit</g) ?? []).length).toBe(2);
    expect((html.match(/>Delete</g) ?? []).length).toBe(2);
  });
  it("leaves planned meals ticked off from the coach's plan to the plan cards", () => {
    expect(render([planned])).not.toContain("Planned breakfast");
  });
  it("offers copy yesterday and copy to another day, with controls at least 44px tall", () => {
    const html = render([rice]);
    expect(html).toContain("Copy yesterday");
    expect(html).toContain("Copy to another day");
    expect(html).not.toMatch(/class="[^"]*\bh-(8|9|10)\b/);
  });
});

describe("FoodSearchLog", () => {
  it("starts as one clear button, free of any AI wording", () => {
    const html = renderToStaticMarkup(createElement(FoodSearchLog, { athleteId: "a1", groupId: "g1", logDate: "2026-10-08", onLogged() {} }));
    expect(html).toContain("Search foods");
    expect(html).toContain("min-h-[44px]");
    expect(html).not.toMatch(/\bAI\b/);
  });
});
