import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroceryListPanel } from "@/components/coach/nutrition/grocery-list-panel";
import { compileGroceryList, groceryItemId, groceryListText, type PlanDay } from "@/lib/grocery-list";

// The coach Nutrition page revamp (Ron, Nov 19): the grocery list, Targets and the meal planner pieces of the build order. (Stars and Favorite meals: lib/starred-meals.test.ts;
// the Clients list: lib/coach-nutrition-week.test.ts; the page's tabs and sections: nutrition-consolidation.test.ts.)
const src = (p: string) => readFileSync(join(__dirname, "../../..", p), "utf8").replace(/\r\n/g, "\n");

const chicken = { name: "Chicken Breast", label: "Chicken Breast", grams: 200, text: "<strong>Chicken Breast:</strong> 200g", foodKey: "chicken_breast", category: "proteins" as const, qty: 200, unit: "g" as const };
const rice = { name: "Jasmine Rice", label: "Jasmine Rice (Dry)", grams: 80, text: "<strong>Jasmine Rice:</strong> 80g", foodKey: "jasmine_rice_dry", category: "starches" as const, qty: 80, unit: "g" as const };
const entry = (mealId: string, lines: unknown[]) => ({ mealId, title: mealId, proteinTarget: 0, carbsTarget: 0, fatTarget: 0, recipes: [{ recipeId: mealId, recipeName: mealId, ingredients: [], lines }] as never });
const day = (date: string): PlanDay => ({ date, carbCycling: false, meals: { daily: [entry("lunch", [chicken, rice]), entry("dinner", [chicken])] } });

describe("the grocery list", () => {
  it("adds the same ingredient across meals and days into one line, grouped by aisle, in grams", () => {
    const list = compileGroceryList([day("2026-11-20"), day("2026-11-21")], { metric: true });
    expect(list.categories.map((c) => c.label)).toEqual(["Proteins", "Starches and grains"]);
    expect(list.categories[0].items).toEqual([expect.objectContaining({ name: "Chicken Breast", qty: 800, display: "800g" })]);
    expect(list.categories[1].items[0].display).toBe("160g");
  });

  it("every item can be ticked as already there; a ticked item stays on the list (crossed off) and is shared as such", () => {
    const html = renderToStaticMarkup(createElement(GroceryListPanel, { days: [day("2026-11-20")], clientName: "Sam", metric: true, storageKey: "k" }));
    expect(html).toContain('aria-label="Already have Chicken Breast"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("it stays on the list, crossed off. Tap it again to untick it.");
    expect(html).toContain("Share");
    expect(html).toContain("Print");
    expect(html).not.toContain("Instacart");
    const list = compileGroceryList([day("2026-11-20")], { metric: true });
    const have = new Set([groceryItemId(list.categories[0].items[0])]);
    expect(groceryListText(list, "LIST", have)).toContain("  Chicken Breast: 400g (have it)");
    expect(groceryListText(list, "LIST", have)).toMatch(/\n {2}Jasmine[^\n]*Rice: 80g\n/);
  });

  it("an untick never deletes: the panel toggles the tick and keeps the item; the ticks live on the device only", () => {
    const panel = src("components/coach/nutrition/grocery-list-panel.tsx");
    expect(panel).toContain("if (next.has(id)) next.delete(id);\n      else next.add(id);");
    expect(panel).toContain('got ? "text-steel line-through" : "text-chalk"');
    expect(panel).toContain("window.localStorage.setItem(storageKey");
    // kept per week: last week's ticks never carry onto next week's list
    expect(panel).toContain("const storageKey = baseKey && days.length > 0 ? `${baseKey}:${getWeekDates(days[0].date)[0]}` : undefined;");
    expect(panel).toContain('typeof navigator.share === "function"');
    expect(src("components/coach/nutrition/grocery-list-section.tsx")).toContain("storageKey={`grocery-have:coach:${athleteId}`}");
    expect(src("components/athlete/client-grocery-list.tsx")).toContain("storageKey={`grocery-have:client:${athleteId}`}");
  });
});

describe("review fixes (Nov 19)", () => {
  it("the star is never a disabled button (a tap on one inside a planner option could tick the option); it ignores taps until loaded", () => {
    const star = src("components/coach/nutrition/star-meal-button.tsx");
    expect(star).not.toMatch(/\sdisabled=\{/);
    expect(star).toContain("aria-disabled={busy || on === null}");
    expect(star).toContain("if (!star || busy || on === null) return;");
  });
  it("Add to plan lists each client once", () => {
    const list = src("components/coach/nutrition/favorite-meals-list.tsx");
    expect(list).toContain("clients.filter((c, i) => clients.findIndex((x) => x.id === c.id) === i).map((c) => (");
    expect(list).toContain("<option key={c.id} value={c.id}>");
  });
});

describe("Targets", () => {
  it("lead with calories and protein; carbs and fat are shown, marked optional, never required; the calculator is Calculate targets", () => {
    const card = src("components/coach/desktop/standing-macro-target-card.tsx");
    expect(card).toContain('{ key: "carbsG", macro: "carbs", label: "Carbs", unit: "g", max: 3000, optional: true }');
    expect(card).toContain('{ key: "fatG", macro: "fat", label: "Fat", unit: "g", max: 1500, optional: true }');
    expect(card).toContain('{f.label} ({f.unit}){f.optional ? ", optional" : ""}');
    expect(card).toContain("Calculate targets");
    // one number is enough to save
    expect(card).toContain("Enter at least one number, or use Remove to clear the standing target.");
    expect(card.indexOf('key: "calories"')).toBeLessThan(card.indexOf('key: "carbsG"'));
    expect(src("components/coach/nutrition/client-nutrition.tsx")).toContain("data-header-target");
  });
});

describe("the meal planner", () => {
  it("each option shows calories and protein first; Repeat this meal on other days; buttons are 44px", () => {
    const g = src("components/coach/desktop/meal-plan-generator.tsx");
    expect(g).toContain("caloriesProteinLine({ calories: opt.macros.calories, proteinG: opt.macros.proteinG })");
    expect(g).toContain("caloriesProteinLine({ calories: opt.verifiedMacros.kcal, proteinG: opt.verifiedMacros.protein })");
    expect(g).toContain("Repeat this meal on other days");
    expect(g).not.toContain("Assign this meal to specific days this week");
    expect(g).toContain('className={`w-11 h-11 font-body text-xs border ${');
    expect(g).not.toMatch(/className="[^"]*\bh-(7|8|9|10)\b/);
    // still three options a meal from the library
    expect(g).toContain("three library options for every meal");
  });
});

describe("phone first", () => {
  it("the Clients list folds away on a phone once a client is open, and every list row and tab is a 44px target", () => {
    const page = src("app/(coach)/groups/[groupId]/nutrition/page.tsx");
    expect(page).toContain('<details className="md:hidden border border-steel/20" open={!selected} data-client-list-phone>');
    expect(page).toContain('<div className="hidden md:block border border-steel/20">');
    expect(page).toContain("className={`min-h-11 px-4 flex items-center font-body text-sm border ${");
    expect(src("components/coach/nutrition/nutrition-client-list.tsx")).toContain("block min-h-11 px-3 py-2");
    expect(src("components/coach/nutrition/fold-section.tsx")).toContain("min-h-14");
  });
});
