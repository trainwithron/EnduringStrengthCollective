import { describe, expect, it } from "vitest";
import { checkLines } from "./allergen-check";
import { mergeRules, rulesFromTypedText } from "./typed-restrictions";
import { mergeMealIntoPlan, type MealEntryPayload, type MealPlanRow } from "./meal-plan-assignment";
import { EDITED_BY_HAND_RATIONALE, LIBRARY_WEEK_RATIONALE, planWeekReplacement } from "./week-replace";

const flagged = (group: string, line: string) => checkLines([line], { dislikes: [group] }).length > 0;
const allFlagged = (group: string, lines: string[]) => lines.forEach((l) => expect(flagged(group, l), `${group}: ${l}`).toBe(true));
const noneFlagged = (group: string, lines: string[]) => lines.forEach((l) => expect(flagged(group, l), `${group}: ${l}`).toBe(false));

describe("a dislike or allergy that names a food GROUP covers the group's foods", () => {
  it("no pork: bacon, ham, sausage, pepperoni, chorizo, pancetta, prosciutto", () => {
    allFlagged("pork", ["Bacon & eggs", "Honey glazed ham", "Italian sausage", "Pepperoni slices", "Chorizo", "Pancetta cubes", "Prosciutto", "Pork chop"]);
    noneFlagged("pork", ["Turkey sausage", "Turkey bacon strips", "Vegan sausage", "Plant based bacon", "Graham crackers", "Chicken breast", "Hamburger bun"]);
  });
  it("no beef: steak, sirloin, ribeye, NY strip, brisket, jerky, burger, meatball", () => {
    allFlagged("beef", ["Sirloin steak", "Ribeye", "NY Strip (Raw)", "Brisket", "Beef jerky", "Burger patty", "Meatballs", "Ground beef 90/10", "Chuck roast"]);
    noneFlagged("beef", ["Tuna steak", "Salmon steak", "Turkey burger", "Veggie burger", "Black bean burger", "Cauliflower steak", "Chicken strips", "Turkey meatballs"]);
  });
  it("no chicken: thigh, drumstick, wings, poultry (not chickpeas)", () => {
    allFlagged("chicken", ["Chicken thigh", "Drumsticks", "Buffalo wings", "Roast poultry"]);
    noneFlagged("chicken", ["Chickpeas", "Turkey breast", "Hummus"]);
  });
  it("no poultry and no turkey", () => {
    allFlagged("poultry", ["Turkey breast", "Duck", "Chicken"]);
    allFlagged("turkey", ["Ground turkey 93/7", "Turkey bacon"]);
    noneFlagged("turkey", ["Chicken"]);
  });
  it("no red meat: beef, pork, lamb, venison, bison", () => {
    allFlagged("red meat", ["Lamb chops", "Venison", "Bison burger", "Bacon", "Sirloin"]);
    noneFlagged("red meat", ["Chicken", "Salmon", "Turkey"]);
  });
  it("no meat: poultry and red meat, not fish and not meat-free foods", () => {
    allFlagged("meat", ["Chicken", "Beef jerky", "Bacon", "Turkey sausage", "Bone broth"]);
    noneFlagged("meat", ["Salmon", "Plant based sausage", "Meatless meatballs", "Tofu", "Greek yogurt"]);
  });
  it("no seafood: fish and shellfish, not oyster mushrooms", () => {
    allFlagged("seafood", ["Salmon fillet", "Shrimp", "Canned tuna", "Scallops", "Cod"]);
    noneFlagged("seafood", ["Chicken", "Oyster mushrooms", "Crab apple jelly", "Beef"]);
  });
  it("no animal products: meat, fish, dairy, eggs and honey", () => {
    allFlagged("animal products", ["Chicken", "Salmon", "Greek yogurt", "Whole eggs", "Honey"]);
    noneFlagged("animal products", ["Tofu", "Oats", "Almond milk", "Blueberries"]);
  });
  it("the saved Dislikes, an Intolerance and an 'other:' allergy get the same group behaviour", () => {
    expect(checkLines(["Bacon"], { dislikes: ["Pork"] }).map((h) => h.kind)).toEqual(["dislike"]);
    expect(checkLines(["Sirloin"], { intolerances: ["beef"] }).map((h) => h.kind)).toEqual(["intolerance"]);
    expect(checkLines(["Pepperoni"], { allergies: ["other: pork"] }).map((h) => h.kind)).toEqual(["allergy"]);
    expect(checkLines(["Chicken"], { dislikes: ["pork"] })).toEqual([]);
  });
  it("a typed 'no pork' / 'no meat' reaches the same checks", () => {
    const pork = mergeRules({}, rulesFromTypedText("no pork"));
    expect(checkLines(["Bacon & eggs"], pork)).not.toEqual([]);
    const meat = mergeRules({}, rulesFromTypedText("no meat"));
    expect(checkLines(["Chicken breast"], meat)).not.toEqual([]);
    expect(checkLines(["Salmon"], meat)).toEqual([]);
  });
});

describe("the typed note: stricter diets win, liking is not restricting", () => {
  it("a typed vegan beats a saved vegetarian; a saved vegan is never relaxed to vegetarian", () => {
    expect(mergeRules({ dietType: "vegetarian" }, rulesFromTypedText("vegan")).dietType).toBe("vegan");
    expect(mergeRules({ dietType: "vegan" }, rulesFromTypedText("vegetarian")).dietType).toBe("vegan");
    expect(mergeRules({ dietType: "pescatarian" }, rulesFromTypedText("vegetarian")).dietType).toBe("vegetarian");
    expect(mergeRules({ dietType: "keto" }, rulesFromTypedText("vegetarian")).dietType).toBe("vegetarian");
    expect(mergeRules({ dietType: "keto" }, rulesFromTypedText("")).dietType).toBe("keto");
    expect(mergeRules({ dietType: "omnivore" }, rulesFromTypedText("")).dietType).toBe("omnivore");
  });
  it("'likes eggs, loves cheese' is a boost, not an egg and dairy allergy", () => {
    const t = rulesFromTypedText("likes eggs, loves cheese, no peanuts");
    expect(t.allergies).toEqual(["peanut"]);
    expect(t.likes.sort()).toEqual(["cheese", "eggs"]);
    expect(t.dislikes).toEqual([]);
    expect(rulesFromTypedText("likes vegan cheese").dietType).toBeNull();
  });
  it("'no animal products' is vegan; 'no meat' is a dislike of the meat group, not a diet", () => {
    expect(rulesFromTypedText("no animal products").dietType).toBe("vegan");
    const meat = rulesFromTypedText("no meat");
    expect(meat.dislikes).toEqual(["meat"]);
    expect(meat.dietType).toBeNull();
  });
});

describe("a day the library built and the coach then edited is no longer the library's", () => {
  const entry = (id: string): MealEntryPayload => ({ mealId: id, title: "Lunch", proteinTarget: 1, carbsTarget: 1, fatTarget: 1, recipes: [] });
  const libraryRow: MealPlanRow = { archetype: "omnivore", meal_count: 3, include_snack: false, carb_cycling: false, rationale: LIBRARY_WEEK_RATIONALE, macros: {}, meals: { daily: [entry("1"), entry("2")] } };
  const fallback = { archetype: "omnivore", mealCount: 3, includeSnack: false, carbCycling: false, macros: {} };
  it("dropping or assigning a meal into a library day relabels it", () => {
    const edited = mergeMealIntoPlan(libraryRow, "daily", entry("2"), fallback);
    expect(edited.rationale).toBe(EDITED_BY_HAND_RATIONALE);
    expect(edited.rationale).not.toBe(LIBRARY_WEEK_RATIONALE);
  });
  it("a hand-made day keeps its own rationale, and a new day keeps the existing note", () => {
    expect(mergeMealIntoPlan({ ...libraryRow, rationale: "weekly check-in" }, "daily", entry("2"), fallback).rationale).toBe("weekly check-in");
    expect(mergeMealIntoPlan(null, "daily", entry("1"), fallback).rationale).toMatch(/Meal assigned individually/);
  });
  it("build a week, edit one day by drag and drop, rebuild: that day is skipped unless the box is ticked", () => {
    const dates = ["2026-10-07", "2026-10-08", "2026-10-09"];
    const built = dates.map((d) => ({ log_date: d, rationale: LIBRARY_WEEK_RATIONALE }));
    const afterEdit = built.map((r) => (r.log_date === "2026-10-08" ? { ...r, rationale: mergeMealIntoPlan(libraryRow, "daily", entry("2"), fallback).rationale } : r));
    const rebuild = planWeekReplacement({ dates, todayKey: "2026-10-07", existing: afterEdit, replaceHandBuilt: false });
    expect(rebuild.write).toEqual(["2026-10-07", "2026-10-09"]);
    expect(rebuild.skippedHand).toEqual(["2026-10-08"]);
    const ticked = planWeekReplacement({ dates, todayKey: "2026-10-07", existing: afterEdit, replaceHandBuilt: true });
    expect(ticked.write).toEqual(dates);
    expect(ticked.replacingHand).toEqual(["2026-10-08"]);
  });
});
