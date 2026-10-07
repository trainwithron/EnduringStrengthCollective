import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  addItem,
  addOtherAllergy,
  allergyLabel,
  cleanItem,
  hasFoodRules,
  judgeProteinDay,
  preferencesToRow,
  proteinGramsForWeight,
  removeItem,
  restrictionsTextFromPreferences,
  rowToPreferences,
  toggleAllergy,
  validateProteinSettings,
} from "@/lib/nutrition-preferences";

describe("reading the row", () => {
  it("no row is the defaults (target 1.0, floor 0.8, three meals, a few favorites)", () => {
    const p = rowToPreferences(null);
    expect(p).toEqual(DEFAULT_PREFERENCES);
    expect(p.proteinGPerLb).toBe(1);
    expect(p.proteinFloorGPerLb).toBe(0.8);
    expect(p.variety).toBe("few_favorites");
  });
  it("reads numbers that arrive as strings (numeric columns), and clamps what cannot be right", () => {
    const p = rowToPreferences({ protein_g_per_lb: "1.20", protein_floor_g_per_lb: "0.90", meals_per_day: 9, diet_type: "pescatarian", variety: "mix_it_up", carb_split: "low" });
    expect(p.proteinGPerLb).toBe(1.2);
    expect(p.proteinFloorGPerLb).toBe(0.9);
    expect(p.mealsPerDay).toBe(6);
    expect(p.dietType).toBe("pescatarian");
    expect(p.variety).toBe("mix_it_up");
    expect(p.carbSplit).toBe("low");
  });
  it("a bad value falls back to its default, and a floor can never read above the target", () => {
    const p = rowToPreferences({ diet_type: "nonsense", variety: "x", carb_split: "y", protein_g_per_lb: 0.9, protein_floor_g_per_lb: 1.4 });
    expect(p.dietType).toBe("omnivore");
    expect(p.variety).toBe("few_favorites");
    expect(p.carbSplit).toBe("balanced");
    expect(p.proteinFloorGPerLb).toBe(0.9);
  });
  it("copies the lists rather than sharing them", () => {
    const row = { likes: ["rice"], allergies: ["peanut"] };
    const p = rowToPreferences(row);
    p.likes.push("beans");
    expect(row.likes).toEqual(["rice"]);
  });
});

describe("what is written", () => {
  const p = { ...DEFAULT_PREFERENCES, likes: ["rice"], allergies: ["peanut"], dietType: "vegan" as const, proteinGPerLb: 1.1, proteinFloorGPerLb: 0.9, carbSplit: "high" as const };
  it("a coach writes everything, including the rules that shape the numbers", () => {
    const row = preferencesToRow(p, "a1");
    expect(row).toMatchObject({ athlete_id: "a1", diet_type: "vegan", protein_g_per_lb: 1.1, protein_floor_g_per_lb: 0.9, carb_split: "high", likes: ["rice"], allergies: ["peanut"] });
  });
  it("a client writes tastes only: the rules that shape the numbers are not even sent", () => {
    const row = preferencesToRow(p, "a1", { onlyTastes: true });
    expect(Object.keys(row).sort()).toEqual(["allergies", "athlete_id", "dislikes", "include_snack", "intolerances", "likes", "meals_per_day", "notes", "variety"]);
    expect(row).not.toHaveProperty("diet_type");
    expect(row).not.toHaveProperty("protein_g_per_lb");
    expect(row).not.toHaveProperty("protein_floor_g_per_lb");
    expect(row).not.toHaveProperty("carb_split");
  });
});

describe("typing chips", () => {
  it("trims, collapses spaces, and caps at 60 characters", () => {
    expect(cleanItem("  sweet   potato  ")).toBe("sweet potato");
    expect(cleanItem("x".repeat(100))).toHaveLength(60);
    expect(cleanItem("   ")).toBe("");
  });
  it("adds once (case-insensitive), ignores blanks, and stops at the cap", () => {
    expect(addItem([], "Rice").list).toEqual(["Rice"]);
    expect(addItem(["Rice"], " rice ").list).toEqual(["Rice"]);
    expect(addItem(["Rice"], "  ").list).toEqual(["Rice"]);
    const full = Array.from({ length: 40 }, (_, i) => `food${i}`);
    const r = addItem(full, "one more");
    expect(r.list).toHaveLength(40);
    expect(r.error).toContain("full");
  });
  it("removes one item", () => {
    expect(removeItem(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
  it("allergies toggle the controlled names and add free text as 'other: ...' in lower case", () => {
    expect(toggleAllergy([], "Peanut")).toEqual(["peanut"]);
    expect(toggleAllergy(["peanut", "egg"], "peanut")).toEqual(["egg"]);
    expect(addOtherAllergy([], "Kiwi").list).toEqual(["other: kiwi"]);
    expect(addOtherAllergy([], "other: Kiwi").list).toEqual(["other: kiwi"]);
    expect(addOtherAllergy(["other: kiwi"], "KIWI").list).toEqual(["other: kiwi"]);
    expect(addOtherAllergy([], "  ").list).toEqual([]);
    expect(addOtherAllergy(Array.from({ length: 20 }, (_, i) => `other: x${i}`), "y").error).toContain("full");
  });
  it("labels an allergy for display", () => {
    expect(allergyLabel("tree nut")).toBe("Tree nuts");
    expect(allergyLabel("other: kiwi")).toBe("kiwi");
    expect(allergyLabel("peanut")).toBe("Peanut");
  });
});

describe("protein target and floor", () => {
  it("accepts the defaults and the edges", () => {
    expect(validateProteinSettings(1.0, 0.8)).toBeNull();
    expect(validateProteinSettings(0.6, 0.4)).toBeNull();
    expect(validateProteinSettings(1.5, 1.5)).toBeNull();
  });
  it("refuses a target or floor out of range and a floor above the target", () => {
    expect(validateProteinSettings(0.5, 0.4)).toMatch(/target/);
    expect(validateProteinSettings(1.6, 1.0)).toMatch(/target/);
    expect(validateProteinSettings(1.0, 0.3)).toMatch(/floor/);
    expect(validateProteinSettings(1.0, 1.1)).toMatch(/can't be above/);
    expect(validateProteinSettings(Number.NaN, 0.8)).toMatch(/target/);
  });
  it("grams for a weight, rounded", () => {
    expect(proteinGramsForWeight({ proteinGPerLb: 1.0, proteinFloorGPerLb: 0.8 }, 180)).toEqual({ targetG: 180, floorG: 144 });
    expect(proteinGramsForWeight({ proteinGPerLb: 1.1, proteinFloorGPerLb: 0.85 }, 173)).toEqual({ targetG: 190, floorG: 147 });
  });
  it("judges a day: at or above target is a hit, between is solid, below the floor is a shortfall", () => {
    expect(judgeProteinDay(180, 180, 144)).toBe("hit");
    expect(judgeProteinDay(200, 180, 144)).toBe("hit");
    expect(judgeProteinDay(179, 180, 144)).toBe("solid");
    expect(judgeProteinDay(144, 180, 144)).toBe("solid");
    expect(judgeProteinDay(143, 180, 144)).toBe("shortfall");
    expect(judgeProteinDay(0, 180, 144)).toBe("shortfall");
  });
});

describe("food rules", () => {
  it("only a declared allergy, intolerance, dislike or a diet that excludes foods counts", () => {
    expect(hasFoodRules(DEFAULT_PREFERENCES)).toBe(false);
    expect(hasFoodRules({ ...DEFAULT_PREFERENCES, allergies: ["peanut"] })).toBe(true);
    expect(hasFoodRules({ ...DEFAULT_PREFERENCES, dislikes: ["liver"] })).toBe(true);
    expect(hasFoodRules({ ...DEFAULT_PREFERENCES, dietType: "vegan" })).toBe(true);
    expect(hasFoodRules({ ...DEFAULT_PREFERENCES, dietType: "pescatarian" })).toBe(true);
    expect(hasFoodRules({ ...DEFAULT_PREFERENCES, dietType: "keto" })).toBe(false);
  });
});

describe("the restrictions line for the generator", () => {
  it("turns the preferences into the plain text the generator already takes", () => {
    expect(restrictionsTextFromPreferences({ allergies: ["peanut", "other: kiwi"], intolerances: ["Lactose"], dislikes: ["Mushrooms"], dietType: "vegetarian" })).toBe(
      "vegetarian, no peanut, no kiwi, no lactose, no mushrooms"
    );
  });
  it("is empty when there is nothing to say", () => {
    expect(restrictionsTextFromPreferences({ allergies: [], intolerances: [], dislikes: [], dietType: "omnivore" })).toBe("");
  });
  it("names the diet types the archetype reader looks for", () => {
    expect(restrictionsTextFromPreferences({ allergies: [], intolerances: [], dislikes: [], dietType: "keto" })).toBe("keto");
    expect(restrictionsTextFromPreferences({ allergies: ["tree nut"], intolerances: [], dislikes: [], dietType: "omnivore" })).toBe("no tree nuts");
  });
});
