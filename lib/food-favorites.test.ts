import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { favoriteFromEntry, foodFavoriteKey, mapFavoriteRow } from "./food-favorites";
import { insertFoodLogEntry } from "./food-log-insert";

describe("food favorites", () => {
  it("treats the same food typed differently as one favorite", () => {
    expect(foodFavoriteKey("Chipotle bowl")).toBe("food:chipotle bowl");
    expect(foodFavoriteKey("  chipotle   BOWL ")).toBe("food:chipotle bowl");
    expect(foodFavoriteKey("Chipotle bowl")).not.toBe(foodFavoriteKey("Chipotle burrito"));
  });

  it("saves an entry's own macros as they are, and needs a name and calories", () => {
    const f = favoriteFromEntry({ description: " Chipotle bowl ", calories: 650, proteinG: 40, carbsG: 70, fatG: 20 });
    expect(f).toEqual({ key: "food:chipotle bowl", label: "Chipotle bowl", calories: 650, proteinG: 40, carbsG: 70, fatG: 20 });
    expect(favoriteFromEntry({ description: null, calories: 400, proteinG: 30, carbsG: 40, fatG: 10 })).toBeNull();
    expect(favoriteFromEntry({ description: null, calories: 400, proteinG: 30, carbsG: 40, fatG: 10 }, "Lunch: chicken and rice")?.label).toBe("Lunch: chicken and rice");
    expect(favoriteFromEntry({ description: "Water", calories: null, proteinG: null, carbsG: null, fatG: null })).toBeNull();
  });

  it("reads a stored row back with the frozen macros, and skips a row without a name or calories", () => {
    expect(mapFavoriteRow({ recipe_id: "food:x", label: "X", calories: "300", protein_g: "25", carbs_g: null, fat_g: "9" })).toEqual({ key: "food:x", label: "X", calories: 300, proteinG: 25, carbsG: null, fatG: 9 });
    expect(mapFavoriteRow({ recipe_id: "l_chicken_rice", label: null, calories: null, protein_g: null, carbs_g: null, fat_g: null })).toBeNull();
  });
});

describe("logging from a tap", () => {
  it("writes an ordinary quick log entry with the given macros and returns it", async () => {
    const insert = vi.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "e1" }, error: null }) }) });
    const supabase = { from: vi.fn().mockReturnValue({ insert }) } as any;
    const entry = await insertFoodLogEntry(supabase, { athleteId: "a", groupId: "g", logDate: "2026-10-06", description: "Chipotle bowl", calories: 650, proteinG: 40, carbsG: 70, fatG: 20 });
    expect(supabase.from).toHaveBeenCalledWith("food_log_entries");
    expect(insert).toHaveBeenCalledWith({ athlete_id: "a", group_id: "g", log_date: "2026-10-06", meal_slot: null, status: "quick_log", description: "Chipotle bowl", calories: 650, protein_g: 40, carbs_g: 70, fat_g: 20 });
    expect(entry).toMatchObject({ id: "e1", status: "quick_log", calories: 650 });
  });
  it("returns nothing when the write fails", async () => {
    const supabase = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: "no" } }) }) }) }) } as any;
    expect(await insertFoodLogEntry(supabase, { athleteId: "a", groupId: "g", logDate: "d", description: "x", calories: 1, proteinG: null, carbsG: null, fatG: null })).toBeNull();
  });
});

describe("favorites stay private", () => {
  const root = join(__dirname, "..");
  function files(rel: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = join(rel, e.name);
      if (e.isDirectory()) out.push(...files(child));
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(child);
    }
    return out;
  }
  it("only the client's own food components read favorite foods, never a coach screen", () => {
    const readers = [...files("app"), ...files("components"), ...files("lib")].filter((f) => {
      const s = readFileSync(join(root, f), "utf8");
      return s.includes("recipe_favorites") && /kind[\"']?,? ?[\"']food|food:|kind: ?[\"']food/.test(s);
    });
    expect(readers.map((f) => f.replace(/\\/g, "/")).sort()).toEqual(["components/athlete/favorite-food-chips.tsx", "components/athlete/favorite-star.tsx", "lib/food-favorites.ts"]);
    expect(statSync(join(root, "components/athlete/favorite-star.tsx")).isFile()).toBe(true);
  });
});
