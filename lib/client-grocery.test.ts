import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clientGroceryDays } from "./client-grocery";
import { compileGroceryList } from "./grocery-list";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");
const lineOf = (name: string, key: string, grams: number, category = "proteins") => ({ name, label: name, grams, text: `<strong>${name}:</strong> ${grams}g`, foodKey: key, category, qty: grams, unit: "g" });
const recipe = (id: string, recipeName: string, ingredients: string[], lines: ReturnType<typeof lineOf>[]) => ({ recipeId: id, recipeName, ingredients, lines });
const entry = (recipes: unknown[]) => ({ mealId: "1", title: "Lunch", proteinTarget: 0, carbsTarget: 0, fatTarget: 0, recipes });
const row = (date: string) => ({
  log_date: date,
  carb_cycling: false,
  meals: { daily: [entry([recipe("a", "Chicken and rice", ["Chicken Breast: 170g"], [lineOf("Chicken Breast", "chicken_breast", 170)]), recipe("b", "Peanut noodles", ["Peanut Butter: 40g"], [lineOf("Peanut Butter", "peanut_butter", 40, "fats")])])] },
});
const none = { allergies: [], intolerances: [], dislikes: [], dietType: "omnivore" };

const names = (rules: Parameters<typeof clientGroceryDays>[1], mode: "split" | "featured" = "split") => {
  const days = clientGroceryDays([row("2026-10-18"), row("2026-10-19")], rules);
  if (!days) return null;
  return compileGroceryList(days, { mode }).categories.flatMap((c) => c.items.map((i) => i.name));
};

describe("a client's own grocery list", () => {
  it("lists what the plan lists when they have no food rules", () => {
    const list = (names(none) ?? []).join(" ").toLowerCase();
    expect(list).toContain("chicken");
    expect(list).toContain("peanut");
  });

  it("never asks a client with a peanut allergy to buy peanuts: the option is filtered the way their plan screen filters it", () => {
    const list = (names({ ...none, allergies: ["peanut"] }) ?? []).join(" ").toLowerCase();
    expect(list).toContain("chicken");
    expect(list).not.toContain("peanut");
  });

  it("lists nothing at all when their rules could not be read (fail closed)", () => {
    expect(clientGroceryDays([row("2026-10-18")], "unreadable")).toBeNull();
  });

  it("skips a day with no meals saved and says nothing about a week with no plan", () => {
    expect(clientGroceryDays([{ log_date: "2026-10-18", carb_cycling: null, meals: null }, { log_date: "2026-10-19", carb_cycling: null, meals: [] }], none)).toEqual([]);
    expect(clientGroceryDays([], none)).toEqual([]);
  });
});

describe("how it is wired", () => {
  it("is on the client's own Nutrition page, built from their own plan and their own rules, and it is a read", () => {
    const page = src("app/(coach)/groups/[groupId]/nutrition/page.tsx");
    expect(page).toContain("<ClientGroceryList athleteId={athleteId}");
    expect(page).toContain("rules={clientRules}");
    const section = src("components/athlete/client-grocery-list.tsx");
    expect(section).toContain('.eq("athlete_id", athleteId)');
    expect(section).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect(section).toContain("clientGroceryDays(");
  });
  it("the panel says client words to a client and coach words to a coach", () => {
    const panel = src("components/coach/nutrition/grocery-list-panel.tsx");
    expect(panel).toContain("Your coach hasn't saved a meal plan for the coming week yet.");
    expect(panel).toContain("Build the week above");
    expect(panel).toContain('audience === "client" ? "Grocery list"');
  });
});
