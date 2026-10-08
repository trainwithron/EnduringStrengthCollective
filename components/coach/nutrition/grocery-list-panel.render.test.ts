import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroceryListPanel } from "@/components/coach/nutrition/grocery-list-panel";
import type { PlanDay } from "@/lib/grocery-list";

const line = { name: "Chicken Breast", label: "Chicken Breast", grams: 200, text: "<strong>Chicken Breast:</strong> 200g", foodKey: "chicken_breast", category: "proteins" as const, qty: 200, unit: "g" as const };
const entry = (recipes: unknown[]) => ({ mealId: "1", title: "Breakfast", proteinTarget: 0, carbsTarget: 0, fatTarget: 0, recipes: recipes as never });
const dayOf = (date: string, meals: PlanDay["meals"]): PlanDay => ({ date, carbCycling: false, meals });
const render = (days: PlanDay[], metric = false) => renderToStaticMarkup(createElement(GroceryListPanel, { days, clientName: "Sam", metric }));

describe("GroceryListPanel", () => {
  it("shows the week's foods by category with the old app's rounding", () => {
    const days = Array.from({ length: 7 }, (_, i) => dayOf(`2026-10-0${i + 1}`, { daily: [entry([{ recipeId: "a", recipeName: "A", ingredients: [], lines: [line] }])] }));
    const html = render(days);
    expect(html).toContain("7 days of the saved plan");
    expect(html).toContain("Proteins");
    expect(html).toContain("Chicken Breast");
    expect(html).toContain("1400g");
    expect(html).toContain("Copy");
    expect(html).toContain("Print");
    expect(html).not.toContain("Training days a week");
  });
  it("metric clients get no ounces", () => {
    const html = render([dayOf("2026-10-01", { daily: [entry([{ recipeId: "a", recipeName: "A", ingredients: [], lines: [line] }])] })], true);
    expect(html).toContain("200g");
    expect(html).not.toContain("oz");
  });
  it("asks for the number of training days only for a carb-cycling plan", () => {
    const html = render([dayOf("2026-10-01", { train: [entry([{ recipeId: "a", recipeName: "A", ingredients: [], lines: [line] }])], rest: [entry([{ recipeId: "b", recipeName: "B", ingredients: [], lines: [line] }])] })]);
    expect(html).toContain("Training days a week");
  });
  it("says so plainly when there is no saved plan, and lists foods that have no amounts", () => {
    expect(render([])).toContain("No saved meal plan for the coming week yet");
    const html = render([dayOf("2026-10-01", { daily: [entry([{ recipeId: "r", recipeName: "Mine", ingredients: [], lines: [{ name: "Quinoa", label: "Quinoa", grams: 90 }] }])] })]);
    expect(html).toContain("Also in the plan (amounts not kept)");
    expect(html).toContain("Quinoa");
  });
});
