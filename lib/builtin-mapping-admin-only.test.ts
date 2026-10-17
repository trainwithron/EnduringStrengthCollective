import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("the built-in recipe ingredient mapping is a platform-admin tool", () => {
  it("Favorite meals shows it only to a platform admin and keeps the recipe builder for every coach", () => {
    const tab = src("components/coach/nutrition/favorite-meals-tab.tsx");
    expect(tab).toContain('viewer?.is_platform_admin === true');
    expect(tab).toContain("{showBuiltinMappings && (");
    expect(tab).toContain("<RecipeHubManager initialRecipes={recipes} />");
  });
  it("a mapped food's long name wraps inside the screen instead of running off it", () => {
    const picker = src("components/coach/desktop/usda-food-picker.tsx");
    expect(picker).toContain('className="flex items-center gap-2 min-w-0"');
    expect(picker).toContain("text-moss truncate min-w-0");
  });
});
