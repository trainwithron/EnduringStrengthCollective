import { describe, expect, it } from "vitest";
import { offeredKeysFromPlans } from "./library-data";
import { choiceKey } from "./meal-plan-assignment";

const entry = (recipes: { recipeId: string | null; key?: string }[]) => ({ mealId: "2", title: "Lunch", proteinTarget: 1, carbsTarget: 1, fatTarget: 1, recipes: recipes.map((r) => ({ recipeName: "x", ingredients: [], ...r })) });

describe("what a client was offered before", () => {
  it("reads a saved key, a starter-library id and a coach recipe id, and keeps the nearest day", () => {
    const plans = [
      { log_date: "2026-10-05", meals: { daily: [entry([{ recipeId: "l_chicken_rice_broccoli" }, { recipeId: "0b7d2c4e-1111-4222-8333-444455556666" }])] } },
      { log_date: "2026-10-06", meals: { daily: [entry([{ recipeId: "x", key: "t:l_chicken_rice_broccoli" }])] } },
      { log_date: "2026-10-12", meals: { daily: [entry([{ recipeId: "d_chuck_roast_mash" }])] } },
    ];
    const m = offeredKeysFromPlans(plans, "2026-10-07");
    expect(m.get("t:l_chicken_rice_broccoli")).toBe(1);
    expect(m.get("r:0b7d2c4e-1111-4222-8333-444455556666")).toBe(2);
    // A plan for a day ahead counts too.
    expect(m.get("t:d_chuck_roast_mash")).toBe(5);
  });
  it("ignores a plan with no readable meals", () => {
    expect(offeredKeysFromPlans([{ log_date: "2026-10-05", meals: null }, { log_date: "2026-10-05", meals: [] }, { log_date: "bad", meals: { daily: [] } }], "2026-10-07").size).toBe(0);
  });
  it("a choice with nothing to identify it has no key", () => {
    expect(choiceKey({ recipeId: null, recipeName: "x", ingredients: [] })).toBeNull();
  });
});
