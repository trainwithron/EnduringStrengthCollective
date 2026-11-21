import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the built-in recipe ingredient mapping is a platform-admin tool", () => {
  it("is the platform admin's own page (Nov 21: moved off Favorite meals); every coach sees their starred meals there (the recipe builder left the tab, Nov 19)", () => {
    const tab = src("components/coach/nutrition/favorite-meals-tab.tsx");
    expect(tab).not.toContain("showBuiltinMappings");
    expect(src("app/admin/nutrition-ingredients/page.tsx")).toContain("if (!me?.is_platform_admin)");
    expect(tab).toContain("<FavoriteMealsList initialMeals={meals} clients={clients} todayKey={todayKey} />");
    expect(tab).not.toContain("RecipeHubManager");
  });
  it("a mapped food's long name wraps inside the screen instead of running off it", () => {
    const picker = src("components/coach/desktop/usda-food-picker.tsx");
    expect(picker).toContain('className="flex items-center gap-2 min-w-0"');
    expect(picker).toContain("text-moss truncate min-w-0");
  });
});
