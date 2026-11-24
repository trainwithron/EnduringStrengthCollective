import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as fnddsLib from "../scripts/usda-fndds-lib.mjs";
import { correctFoodQuery, runFoodSearch } from "@/lib/food-search-run";
import { FoodSearchLog } from "@/components/athlete/food-search-log";

// Step 226 (Ron, Nov 23: food search round 2, "do 1 and 2"). The SQL side (the word list, the correction, the ranking on real rows) is rehearsed in
// scripts/sql-tests/food-search-round2.test.mjs; these are the app's side: when the second try happens, what the screen says, and the hand-made names.
const { plainNameFor, isCommonFood, PLAIN_NAME_OVERRIDES } = fnddsLib as any;
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

const everydayRow = (description: string, plain_name: string | null = null) => ({ fdc_id: description.length, description, data_type: "Survey (FNDDS)", food_category: null, kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1, plain_name });
const brandedRow = (description: string) => ({ fdc_id: 900 + description.length, gtin: null, brand_owner: null, brand_name: "Acme", description, category: null, serving_size: null, serving_size_unit: null, household_serving: null, kcal: 100, protein_g: 1, carbs_g: null, fat_g: null, fiber_g: null, sugars_g: null, sodium_mg: null });

// A stand-in database: what each search returns for which words, what the correction returns, and every call made.
function fakeDb(opts: { everyday?: Record<string, unknown[] | "fail">; packaged?: Record<string, unknown[]>; correct?: (t: string[]) => unknown; correctFails?: boolean }) {
  const calls: { fn: string; words: string }[] = [];
  const client = {
    rpc: async (fn: string, args: { p_tokens: string[] }) => {
      const words = args.p_tokens.join(" ");
      calls.push({ fn, words });
      if (fn === "search_usda_foods") {
        const rows = opts.everyday?.[words] ?? [];
        return rows === "fail" ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } } : { data: rows, error: null };
      }
      if (fn === "search_branded_foods") return { data: opts.packaged?.[words] ?? [], error: null };
      if (fn === "correct_food_search_words") return opts.correctFails ? { data: null, error: { code: "PGRST202", message: "not found" } } : { data: opts.correct ? opts.correct(args.p_tokens) : args.p_tokens, error: null };
      throw new Error("unexpected rpc " + fn);
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}
const FIX: Record<string, string> = { chiken: "chicken", brocoli: "broccoli", cheerois: "cheerios" };
const fixWords = (t: string[]) => t.map((w) => FIX[w] ?? w);

describe("forgiving spelling: a second try only when nothing at all was found", () => {
  it("chiken breast: nothing found, so it is read as chicken breast and searched again", async () => {
    const { client, calls } = fakeDb({ everyday: { "chicken breast": [everydayRow("Chicken breast, baked, broiled, or roasted, skin not eaten, from raw", "Chicken breast, cooked (no skin)")] }, packaged: { "chicken breast": [brandedRow("CHICKEN BREAST")] }, correct: fixWords });
    const r = await runFoodSearch(client, "chiken breast");
    expect(r.correctedTo).toBe("chicken breast");
    expect(r.hits?.[0].plainName).toBe("Chicken breast, cooked (no skin)");
    expect(r.packaged.map((p) => p.description)).toEqual(["CHICKEN BREAST"]);
    expect(calls.map((c) => `${c.fn}:${c.words}`)).toEqual([
      "search_usda_foods:chiken breast",
      "search_branded_foods:chiken breast",
      "correct_food_search_words:chiken breast",
      "search_usda_foods:chicken breast",
      "search_branded_foods:chicken breast",
    ]);
  });
  it("cheerois: the packaged Cheerios count as found", async () => {
    const { client } = fakeDb({ packaged: { cheerios: [brandedRow("Cheerios Cereal")] }, correct: fixWords });
    const r = await runFoodSearch(client, "cheerois");
    expect(r).toMatchObject({ hits: [], correctedTo: "cheerios" });
    expect(r.packaged[0].description).toBe("Cheerios Cereal");
  });
  it("the spelling is checked at the same time as the searches (no extra wait)", async () => {
    const { client, calls } = fakeDb({ everyday: { "whole milk": [everydayRow("Milk, whole", "Whole milk")] } });
    await runFoodSearch(client, "whole milk");
    expect(calls.map((c) => c.fn)).toEqual(["search_usda_foods", "search_branded_foods", "correct_food_search_words"]);
  });
  it("gibberish: nothing to swap, so no second search and nothing found", async () => {
    const { client, calls } = fakeDb({ correct: (t) => t });
    expect(await runFoodSearch(client, "xqzv")).toEqual({ hits: [], packaged: [], correctedTo: null, suggestion: null });
    expect(calls.filter((c) => c.fn === "search_usda_foods")).toHaveLength(1);
  });
  it("a likely spelling that finds nothing either: says nothing found, with no 'Showing results for'", async () => {
    const { client } = fakeDb({ correct: fixWords });
    expect(await runFoodSearch(client, "brocoli")).toEqual({ hits: [], packaged: [], correctedTo: null, suggestion: null });
  });
  it("a failed everyday search is said as such, never corrected or offered", async () => {
    const { client } = fakeDb({ everyday: { brocoli: "fail" }, packaged: { brocoli: [brandedRow("BROCOLI BITES")] }, correct: fixWords });
    expect(await runFoodSearch(client, "brocoli")).toMatchObject({ hits: null, correctedTo: null, suggestion: null });
  });
  it("a database without step 226 yet: the correction is skipped quietly", async () => {
    const { client } = fakeDb({ correctFails: true, packaged: { avacado: [brandedRow("AVACADO DIP")] } });
    expect(await correctFoodQuery(client, "brocoli")).toBeNull();
    expect(await runFoodSearch(client, "brocoli")).toEqual({ hits: [], packaged: [], correctedTo: null, suggestion: null });
    expect((await runFoodSearch(client, "avacado")).suggestion).toBeNull();
  });
  it("the words go to the database cleaned (the same words the searches get)", async () => {
    const { client, calls } = fakeDb({ correct: fixWords });
    expect(await correctFoodQuery(client, "  Chiken,  BREAST!! ")).toBe("chicken breast");
    expect(calls[0]).toEqual({ fn: "correct_food_search_words", words: "chiken breast" });
    expect(await correctFoodQuery(client, "   ")).toBeNull();
  });
});

describe("Did you mean: something was found as typed, but a word looks misspelled", () => {
  // what the real correct_food_search_words gives for these on live-size data (scripts/sql-tests/food-search-round2.test.mjs checks the same on real rows)
  const LIVE: Record<string, string> = { avacado: "avocado", tumeric: "turmeric", protien: "protein", yougurt: "yogurt", choclate: "chocolate" };
  const liveWords = (t: string[]) => t.map((w) => LIVE[w] ?? w);
  // live, each of these finds a few products misspelled the same way
  const typedFinds: Record<string, unknown[]> = {
    avacado: [brandedRow("ORGANIC HUMMUS, AVACADO & CILANTRO")],
    tumeric: [brandedRow("TUMERIC CHIPS")],
    "protien bar": [brandedRow("BLUEBERRY PROTIEN BAR")],
    "greek yougurt": [brandedRow("GREEK YOUGURT")],
    "choclate milk": [brandedRow("MILK & WHITE CHOCOLATE")],
  };
  const OFFERED: [string, string][] = [
    ["avacado", "avocado"],
    ["tumeric", "turmeric"],
    ["protien bar", "protein bar"],
    ["greek yougurt", "greek yogurt"],
    ["choclate milk", "chocolate milk"],
  ];
  for (const [typed, meant] of OFFERED) {
    it(`${typed}: the results as typed, and "Did you mean ${meant}?"`, async () => {
      const { client, calls } = fakeDb({ packaged: typedFinds, correct: liveWords });
      const r = await runFoodSearch(client, typed);
      expect(r).toMatchObject({ correctedTo: null, suggestion: meant });
      expect(r.packaged).toHaveLength(1);
      // shown as typed: no second search until the line is tapped
      expect(calls.filter((c) => c.fn === "search_usda_foods").map((c) => c.words)).toEqual([typed.replace(/[^a-z0-9]+/g, " ").trim()]);
    });
  }
  // the review of 17ddf1b4: words spelled right (the real function keeps them, food-search-round2.test.mjs) show no "Did you mean"; brand and filler look-alikes lose
  const REVIEW: Record<string, string> = { brest: "breast", wite: "white", bagle: "bagel" };
  const reviewWords = (t: string[]) => t.map((w) => REVIEW[w] ?? w);
  for (const kept of ["creatine", "egg whites", "grapes", "goose", "dal"]) {
    it(`${kept}: spelled right, so no "Did you mean"`, async () => {
      const { client } = fakeDb({ packaged: { [kept]: [brandedRow(kept.toUpperCase())] }, correct: reviewWords });
      expect(await runFoodSearch(client, kept)).toMatchObject({ correctedTo: null, suggestion: null });
    });
  }
  for (const [typed, meant] of [["chicken brest", "chicken breast"], ["wite rice", "white rice"], ["bagle", "bagel"]]) {
    it(`${typed}: "Did you mean ${meant}?" (or searched again when nothing was found)`, async () => {
      const found = fakeDb({ packaged: { [typed]: [brandedRow(typed.toUpperCase())] }, correct: reviewWords });
      expect((await runFoodSearch(found.client, typed)).suggestion).toBe(meant);
      const empty = fakeDb({ everyday: { [meant]: [everydayRow(meant)] }, correct: reviewWords });
      expect((await runFoodSearch(empty.client, typed)).correctedTo).toBe(meant);
    });
  }
  for (const kept of ["whole milk", "2% milk", "chicken breast"]) {
    it(`${kept}: nothing extra shown`, async () => {
      const { client } = fakeDb({ everyday: { "whole milk": [everydayRow("Milk, whole", "Whole milk")], "2 milk": [everydayRow("Milk, reduced fat (2%)", "2% milk")], "chicken breast": [everydayRow("Chicken breast, baked", "Chicken breast, cooked (no skin)")] }, correct: liveWords });
      expect(await runFoodSearch(client, kept)).toMatchObject({ correctedTo: null, suggestion: null });
    });
  }
});

describe("the screen", () => {
  const ui = read("components/athlete/food-search-log.tsx");
  it("one small line above the results: Showing results for **chicken breast**", () => {
    expect(ui).toContain("Showing results for <strong className=\"font-semibold text-chalk\">{correctedTo}</strong>");
    expect(ui.indexOf("data-corrected-query")).toBeLessThan(ui.indexOf("data-food-results"));
    expect(ui).toContain("{!searching && correctedTo && ((hits && hits.length > 0) || packagedHits.length > 0) && (");
  });
  it("the line goes when the search is cleared or a food is added", () => {
    expect(ui.match(/setCorrectedTo\(null\);/g)?.length).toBe(2);
    expect(ui.match(/setSuggestion\(null\);/g)?.length).toBe(2);
    expect(ui).toContain("setCorrectedTo(found.correctedTo);");
    expect(ui).toContain("setSuggestion(found.suggestion);");
  });
  it("a tappable 'Did you mean avocado?' above the results as typed; a tap searches it", () => {
    expect(ui).toContain("{!searching && !correctedTo && suggestion && ((hits && hits.length > 0) || packagedHits.length > 0) && (");
    expect(ui).toContain('<button type="button" onClick={() => setQuery(suggestion)} className="mt-1 min-h-[44px] text-left font-body text-xs text-steel" data-did-you-mean>');
    expect(ui).toContain("Did you mean <strong");
    expect(ui.indexOf("data-did-you-mean")).toBeLessThan(ui.indexOf("data-food-results"));
  });
  it("renders closed and open without the line", () => {
    const props = { athleteId: "a", groupId: "g", logDate: "2026-11-23", onLogged: () => {} };
    expect(renderToStaticMarkup(createElement(FoodSearchLog, props))).toContain("Search foods");
    expect(renderToStaticMarkup(createElement(FoodSearchLog, { ...props, inSheet: true }))).not.toContain("Showing results for");
  });
});

describe("the plain version first: the hand-made names (scripts/usda-fndds-lib.mjs, the same values step 226 writes live)", () => {
  it("the name is what people type for the food", () => {
    expect(plainNameFor("Egg, white, cooked, no added fat")).toBe("Egg whites, cooked");
    expect(plainNameFor("Chicken, NS as to part, baked, broiled, or roasted, skin not eaten")).toBe("Chicken, roasted (no skin)");
    expect(plainNameFor("Tomatoes, raw", "Tomatoes")).toBe("Tomato");
    expect(plainNameFor("Summer squash, green, raw", "Other vegetables and combinations")).toBe("Zucchini, raw");
    expect(plainNameFor("Soybean curd")).toBe("Tofu");
    expect(plainNameFor("Fish, tuna, canned")).toBe("Tuna, canned");
    expect(isCommonFood("Egg, white, cooked, no added fat")).toBe(true);
  });
  it("a name the same as USDA's gives no plain name (USDA's own is shown), and the food is still common", () => {
    expect(plainNameFor("Coffee, brewed")).toBeNull();
    expect(plainNameFor("Pasta, cooked")).toBeNull();
    expect(isCommonFood("Coffee, brewed")).toBe(true);
  });
  it("'excluding' and 'including' are not a kind of the food", () => {
    expect(PLAIN_NAME_OVERRIDES["Walnuts, excluding honey roasted"]).toBeDefined();
    expect(plainNameFor("Pecans, excluding honey roasted")).toBeNull();
    expect(plainNameFor("Cereal, including granola")).toBeNull();
    expect(plainNameFor("Bread, white")).toBe("White bread");
  });
  it("the list of everyday searches the rehearsal checks: about 100, each with the USDA food that must come first", () => {
    const list = JSON.parse(read("scripts/sql-tests/fixtures/everyday-searches.json")) as { search: string; first: string }[];
    expect(list.length).toBeGreaterThanOrEqual(100);
    expect(new Set(list.map((s) => s.search)).size).toBe(list.length);
    expect(list.find((s) => s.search === "egg whites")?.first).toBe("Egg, white, cooked, no added fat");
    // never a mixed dish first (tuna salad is the dish asked for)
    for (const s of list) expect(s.first, s.search).not.toMatch(/\b(with meat|sandwich|dinner|frozen meal|stuffed)\b/i);
    // the names given by hand point at real foods of the list (the import reports any that are missing)
    for (const s of list.filter((x) => PLAIN_NAME_OVERRIDES[x.first])) expect(PLAIN_NAME_OVERRIDES[s.first].common, s.first).toBe(true);
  });
});
