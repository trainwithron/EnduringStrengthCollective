import { describe, expect, it } from "vitest";
import { describeTypedRules, mergeRules, newFromTyped, rulesFromTypedText } from "./typed-restrictions";
import { allergyKeysOf, checkLines } from "./allergen-check";
import { selectOptions, type SelectionContext } from "./library-selection";
import { gridFor } from "@/lib/meal-templates/grid";
import { checkTextOf } from "./scaled-meal";
import { planWeekReplacement, LIBRARY_WEEK_RATIONALE, dayLabel, dayList } from "./week-replace";
import type { LibraryRecipe } from "./library-scaling";

const ctxOf = (over: Partial<SelectionContext> = {}): SelectionContext => ({
  rules: {},
  diet: "omnivore",
  likes: [],
  favorites: { ids: new Set(), names: new Set() },
  recentlyOffered: new Map(),
  mixItUp: false,
  recentDays: 7,
  coachRecipes: [],
  ...over,
});

describe("the coach's typed note becomes rules", () => {
  it("allergen words become allergies, other foods become dislikes, a diet word sets the diet", () => {
    const t = rulesFromTypedText("No dairy, peanut allergy, hates mushrooms and olives, vegetarian");
    expect(t.allergies.sort()).toEqual(["dairy", "peanut"]);
    expect(t.dislikes.sort()).toEqual(["mushrooms", "olives"]);
    expect(t.dietType).toBe("vegetarian");
  });
  it("understands the words people type for an allergen group", () => {
    expect(rulesFromTypedText("lactose intolerant, no gluten").allergies.sort()).toEqual(["dairy", "wheat or gluten"]);
    expect(rulesFromTypedText("shellfish allergy; no eggs").allergies.sort()).toEqual(["egg", "shellfish"]);
    expect(rulesFromTypedText("Vegan, Keto, No eggs").dietType).toMatch(/vegan|keto/);
  });
  it("nothing typed, or 'none', is no rule", () => {
    for (const x of ["", "  ", "none", "No restrictions", "n/a", null, undefined]) expect(rulesFromTypedText(x)).toEqual({ allergies: [], dislikes: [], dietType: null });
  });
  it("merges with the saved rules: unions for allergies and dislikes, the saved diet wins unless it is the default", () => {
    const typed = rulesFromTypedText("no dairy, hates kale, vegan");
    const merged = mergeRules({ allergies: ["peanut"], dislikes: ["beets"], intolerances: ["lactose"], dietType: "omnivore" }, typed);
    expect(merged.allergies?.sort()).toEqual(["dairy", "peanut"]);
    expect(merged.dislikes?.sort()).toEqual(["beets", "kale"]);
    expect(merged.intolerances).toEqual(["lactose"]);
    expect(merged.dietType).toBe("vegan");
    expect(mergeRules({ dietType: "keto" }, typed).dietType).toBe("keto");
    expect(mergeRules(undefined, rulesFromTypedText("")).allergies).toEqual([]);
  });
  it("says what was understood and whether it is new to the saved rules", () => {
    const typed = rulesFromTypedText("no dairy, hates kale");
    expect(describeTypedRules(typed)).toBe("dairy (never offered) · avoids kale");
    expect(newFromTyped({ allergies: ["dairy"], dislikes: ["kale"] }, typed)).toBe(false);
    expect(newFromTyped({ allergies: [] }, typed)).toBe(true);
  });
  it("a typed 'no dairy' removes the dairy meals from what the library offers (the old engine did this, the library path must too)", () => {
    const rules = mergeRules({}, rulesFromTypedText("no dairy, peanut allergy"));
    for (const slot of ["breakfast", "lunch", "dinner", "snack"] as const) {
      for (let i = 0; i < 6; i++) {
        const sel = selectOptions(slot, gridFor("standard", slot)[i], ctxOf({ rules }));
        for (const m of sel.options) expect(checkLines(checkTextOf(m), rules), `${slot} ${m.name}`).toEqual([]);
      }
    }
    const open = selectOptions("breakfast", gridFor("standard", "breakfast")[2], ctxOf());
    const closed = selectOptions("breakfast", gridFor("standard", "breakfast")[2], ctxOf({ rules }));
    expect(closed.leftOutForRules).toBeGreaterThan(0);
    expect(open.options.map((m) => m.key).join()).not.toBe(closed.options.map((m) => m.key).join());
  });
});

describe("a saved recipe cannot hide an allergen", () => {
  const hidden: LibraryRecipe = {
    id: "h1",
    name: "Protein pancakes",
    slot: "breakfast",
    diets: ["omnivore"],
    keywords: [],
    mainProtein: "egg",
    source: "coach",
    lines: [
      { id: "1", label: "Pancake mix", role: "protein_source", proteinPer100g: 20, carbsPer100g: 10, fatPer100g: 3, fixedDisplayText: null, usdaFdcId: 1, gramsRef: 200, matchedDescription: "Wheat flour, white, enriched" },
      { id: "2", label: "Blueberries", role: "carb_source", proteinPer100g: 0.7, carbsPer100g: 14, fatPer100g: 0.3, fixedDisplayText: null, usdaFdcId: 2, gramsRef: 200 },
    ],
  };
  const target = { proteinG: 42, carbsG: 50, fatG: 8 };
  const fav = { ids: new Set(["h1"]), names: new Set<string>() };
  it("is offered when nothing is wrong, and not to a client with a wheat allergy: the matched real food is checked, not only the label", () => {
    expect(selectOptions("breakfast", target, ctxOf({ coachRecipes: [hidden], favorites: fav })).options.map((m) => m.key)).toContain("r:h1");
    const wheat = selectOptions("breakfast", target, ctxOf({ coachRecipes: [hidden], favorites: fav, rules: { allergies: ["wheat or gluten"] } }));
    expect(wheat.options.map((m) => m.key)).not.toContain("r:h1");
  });
  it("is not offered when its own saved allergen tags name one of the client's allergies, even if the words say nothing", () => {
    const tagged = { ...hidden, lines: hidden.lines.map((l) => ({ ...l, matchedDescription: null })), allergens: ["wheat or gluten"] };
    expect(selectOptions("breakfast", target, ctxOf({ coachRecipes: [tagged], favorites: fav })).options.map((m) => m.key)).toContain("r:h1");
    expect(selectOptions("breakfast", target, ctxOf({ coachRecipes: [tagged], favorites: fav, rules: { allergies: ["gluten"] } })).options.map((m) => m.key)).not.toContain("r:h1");
  });
  it("allergyKeysOf reads the controlled names and typed aliases", () => {
    expect([...allergyKeysOf(["peanut", "lactose", "other: gluten", "other: kiwi"])].sort()).toEqual(["dairy", "peanut", "wheat or gluten"]);
  });
});

describe("which days a week build may write", () => {
  const dates = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"];
  const existing = [
    { log_date: "2026-10-05", rationale: "weekly check-in rationale" },
    { log_date: "2026-10-07", rationale: LIBRARY_WEEK_RATIONALE },
    { log_date: "2026-10-08", rationale: "Meal assigned individually from the weekly picker — no full check-in run for this day." },
    { log_date: "2026-10-09", rationale: null },
  ];
  it("never touches a day that has passed, and by default skips days built by hand", () => {
    const p = planWeekReplacement({ dates, todayKey: "2026-10-07", existing, replaceHandBuilt: false });
    expect(p.skippedPast).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(p.skippedHand).toEqual(["2026-10-08", "2026-10-09"]);
    expect(p.write).toEqual(["2026-10-07", "2026-10-10"]);
    expect(p.replacingLibrary).toEqual(["2026-10-07"]);
    expect(p.replacingHand).toEqual([]);
  });
  it("replaces hand-built days only when asked, and still never a past day", () => {
    const p = planWeekReplacement({ dates, todayKey: "2026-10-07", existing, replaceHandBuilt: true });
    expect(p.write).toEqual(["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
    expect(p.replacingHand).toEqual(["2026-10-08", "2026-10-09"]);
    expect(p.skippedPast).toHaveLength(3);
    expect(p.skippedHand).toEqual([]);
  });
  it("a week with nothing planned builds from today", () => {
    const p = planWeekReplacement({ dates, todayKey: "2026-10-04", existing: [], replaceHandBuilt: false });
    expect(p.write).toEqual(dates);
    expect(p.skippedPast).toEqual([]);
  });
  it("names the days in plain words for the confirmation", () => {
    expect(dayLabel("2026-10-05")).toBe("Mon Oct 5");
    expect(dayList(["2026-10-07", "2026-10-08"])).toBe("Wed Oct 7, Thu Oct 8");
  });
});
