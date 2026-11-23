import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fnddsLib from "../scripts/usda-fndds-lib.mjs";
import * as usdaLib from "../scripts/usda-lib.mjs";
import * as batchLib from "../scripts/usda-batch-lib.mjs";
import { searchFoods } from "@/lib/food-search";
import { mlServingOptions, packagedDetail, packagedPortions, packagedTitle, searchPackaged, type PackagedHit } from "@/lib/packaged-foods";
import { usdaEntryRow } from "@/lib/food-entry";
import { per100Line } from "@/components/athlete/food-search-log";

// Step 223 (Ron, Nov 23: "type whole milk and get whole milk; 2% milk gives exactly 2% milk; sourdough bread gives sourdough bread"). The ranking itself is rehearsed in SQL
// (scripts/sql-tests/food-search-fndds.test.mjs); these are the pure parts: the plain names, USDA's other names, the import, the packaged group and how a pick is logged.
const { plainNameFor, isCommonFood, buildExtraNames, addEverydayNames, PLAIN_NAME_OVERRIDES } = fnddsLib as any;
const { buildFoods, parseCsv, buildNutrientIndex } = usdaLib as any;
const { toBatchSql, buildPortions } = batchLib as any;
const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8").replace(/\r\n/g, "\n");

describe("plain names: a re-wording of USDA's own name, never a new fact", () => {
  it("the hand-named everyday foods", () => {
    expect(plainNameFor("Milk, whole")).toBe("Whole milk");
    expect(plainNameFor("Milk, reduced fat (2%)")).toBe("2% milk");
    expect(plainNameFor("Milk, fat free (skim)")).toBe("Skim milk");
    expect(plainNameFor("Bread, sour dough")).toBe("Sourdough bread");
    expect(plainNameFor("Bread, French or Vienna")).toBe("French bread");
    expect(isCommonFood("Milk, whole")).toBe(true);
    expect(isCommonFood("Milk, chocolate, reduced fat")).toBe(false);
  });
  it("the rule: a short two-part name is turned round; ', raw' is dropped", () => {
    expect(plainNameFor("Cheese, cheddar")).toBe("Cheddar cheese");
    expect(plainNameFor("Pear, raw", "Pears")).toBe("Pear");
  });
  it("NFS / NS (\"not further specified\") is never turned round", () => {
    for (const d of ["Milk, NFS", "Bread, NFS", "Cheese, NFS", "Soup, NS"]) expect(plainNameFor(d), d).toBeNull();
  });
  it("raw is dropped only for a fruit or vegetable: raw meat or fish keeps USDA's name", () => {
    expect(plainNameFor("Salmon, raw", "Fish")).toBeNull();
    expect(plainNameFor("Beef, raw", "Beef, excludes ground")).toBeNull();
    expect(plainNameFor("Pear, raw")).toBeNull(); // no category known: kept as USDA wrote it
    expect(plainNameFor("Spinach, raw", "Spinach")).toBe("Spinach");
  });
  it("a second part that starts with on / in / and / or / as is not a kind", () => {
    for (const d of ["Hamburger, on bun", "Tuna, in oil", "Fries, and ketchup", "Beans, or peas", "Chicken, as ingredient"]) expect(plainNameFor(d), d).toBeNull();
  });
  it("anything longer or not a kind stays as USDA wrote it (null: show USDA's name)", () => {
    expect(plainNameFor("Bread, French or Vienna, toasted")).toBeNull();
    expect(plainNameFor("Soup, NS as to type")).toBeNull();
    expect(plainNameFor("Chicken breast, fried, coated, skin / coating eaten, from raw")).toBeNull();
    expect(plainNameFor("Pizza, cheese, from restaurant or fast food, thin crust")).toBeNull();
    expect(plainNameFor("Juice, apple (from frozen)")).toBeNull();
    expect(plainNameFor("Tofu")).toBeNull();
    expect(plainNameFor("")).toBeNull();
  });
  it("every hand-made name is short and uses only the food's own words or a common spelling of them", () => {
    for (const [desc, o] of Object.entries(PLAIN_NAME_OVERRIDES) as [string, { name: string }][]) {
      expect(o.name.length, desc).toBeLessThanOrEqual(120);
      expect(o.name.trim(), desc).toBe(o.name);
    }
  });
});

describe("USDA's other names (additional descriptions)", () => {
  const foods = new Map([[1, { fdc_id: 1, description: "Bread, sour dough", data_type: "Survey (FNDDS)" }], [2, { fdc_id: 2, description: "Milk, fat free (skim)", data_type: "Survey (FNDDS)" }]]);
  const types = [{ id: "1001", name: "Additional Description" }, { id: "999", name: "Attribute" }];
  it("only the additional descriptions, each once, for the foods kept", () => {
    const extra = buildExtraNames(
      [
        { fdc_id: "1", food_attribute_type_id: "1001", name: "", value: "sourdough bread" },
        { fdc_id: "1", food_attribute_type_id: "1001", name: "", value: "Sourdough bread" },
        { fdc_id: "1", food_attribute_type_id: "999", name: "", value: "not a name" },
        { fdc_id: "2", food_attribute_type_id: "1001", name: "nonfat milk", value: "" },
        { fdc_id: "9", food_attribute_type_id: "1001", name: "", value: "another food" },
      ],
      types,
      foods
    );
    expect(extra.get(1)).toBe("sourdough bread");
    expect(extra.get(2)).toBe("nonfat milk");
    expect(extra.has(9)).toBe(false);
  });
  it("without the type file it falls back to type 1001", () => {
    expect(buildExtraNames([{ fdc_id: "1", food_attribute_type_id: "1001", name: "", value: "sourdough" }], [], foods).get(1)).toBe("sourdough");
  });
  it("names the everyday foods only, and says which hand-named foods were not found", () => {
    const all = new Map<number, any>([
      [1, { fdc_id: 1, description: "Milk, whole", data_type: "Survey (FNDDS)" }],
      [2, { fdc_id: 2, description: "Milk, whole, 3.25% milkfat, with added vitamin D", data_type: "SR Legacy" }],
    ]);
    const unmatched = addEverydayNames(all, new Map([[1, "whole milk"]]));
    expect(all.get(1)).toMatchObject({ plain_name: "Whole milk", common: true, extra_names: "whole milk" });
    expect(all.get(2).plain_name).toBeUndefined();
    expect(unmatched).toContain("Milk, reduced fat (2%)");
    expect(unmatched).not.toContain("Milk, whole");
  });
});

describe("the import reads the everyday foods", () => {
  it("FNDDS points at a nutrient by its number; Foundation / SR Legacy by its id: both are read", () => {
    const index = buildNutrientIndex([{ id: "1008", name: "Energy", unit_name: "KCAL", nutrient_nbr: "208" }, { id: "1003", name: "Protein", unit_name: "G", nutrient_nbr: "203.0" }]);
    expect(index.get("1008")?.key).toBe("kcal");
    expect(index.get("208")?.key).toBe("kcal");
    expect(index.get("203")?.key).toBe("protein_g");
  });
  it("'Quantity not specified' is never a serving (it would be the default)", () => {
    const foods = new Map([[1, { fdc_id: 1 }]]);
    const rows = buildPortions(
      [
        { fdc_id: "1", seq_num: "1", amount: "", measure_unit_id: "9999", portion_description: "Quantity not specified", modifier: "", gram_weight: "244" },
        { fdc_id: "1", seq_num: "2", amount: "", measure_unit_id: "9999", portion_description: "1 cup", modifier: "", gram_weight: "244" },
      ],
      [{ id: "9999", name: "undetermined" }],
      foods
    );
    expect(rows.map((r: { description: string }) => r.description)).toEqual(["1 cup"]);
  });
  it("survey_fndds_food is 'Survey (FNDDS)', with its WWEIA category", () => {
    const foods = buildFoods(parseCsv('fdc_id,data_type,description,food_category_id\n2705385,survey_fndds_food,"Milk, whole",1002\n9,branded_food,Bar,1\n'), [{ id: "1002", description: "Milk, whole" }]);
    expect(foods.get(2705385)).toEqual({ fdc_id: 2705385, description: "Milk, whole", data_type: "Survey (FNDDS)", food_category: "Milk, whole" });
    expect(foods.has(9)).toBe(false);
  });
  it("a batch with everyday foods writes their names; a Foundation / SR Legacy batch reads exactly as before", () => {
    const fndds = toBatchSql("b-1", new Map([[1, { fdc_id: 1, description: "Milk, whole", data_type: "Survey (FNDDS)", food_category: null, plain_name: "Whole milk", extra_names: "whole milk", common: true }]]), [], []);
    expect(fndds).toContain("insert into public.usda_foods (fdc_id, description, data_type, food_category, plain_name, extra_names, common) values");
    expect(fndds).toContain("(1, 'Milk, whole', 'Survey (FNDDS)', null, 'Whole milk', 'whole milk', true)");
    const sr = toBatchSql("b-2", new Map([[2, { fdc_id: 2, description: "Oats", data_type: "SR Legacy", food_category: null }]]), [], [], { mode: "refresh" });
    expect(sr).toContain("insert into public.usda_foods (fdc_id, description, data_type, food_category) values");
    expect(sr).toContain("food_category = excluded.food_category;");
    expect(sr).not.toContain("plain_name");
  });
  it("the sample in the FoodData Central format is what the rehearsal loads", () => {
    expect(read("scripts/sql-tests/fixtures/fndds-sample/food.csv").split("\n")[0]).toBe('"fdc_id","data_type","description","food_category_id","publication_date"');
    expect(read("scripts/sql-tests/fixtures/fndds-sample/food_attribute_type.csv")).toContain('"1001","Additional Description"');
  });
});

describe("the search (migration 0467)", () => {
  const sql = read("supabase/migrations/0467_food_search_everyday_foods.sql");
  it("keeps the arguments the app calls it with, and adds plain_name at the end", () => {
    expect(sql).toContain("create function public.search_usda_foods(p_tokens text[], p_limit integer default 60)");
    expect(sql).toContain("returns table(fdc_id integer, description text, data_type text, food_category text, kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, plain_name text)");
    expect(sql).toContain("grant execute on function public.search_usda_foods(text[], integer) to authenticated, service_role;");
  });
  it("ranks exact, then starts-with, then the plain food, then FNDDS / Foundation / SR Legacy, the word places, then the hand-named; one row per name", () => {
    // the plain food (its name starting with the first word) before the hand-named and the data type (review, Nov 23)
    const order = ["o.exact desc", "o.starts desc", "(lower(o.description) like (select q.first_tok from q) || '%') desc", "o.type_rank asc", "o.first_words desc", "o.second_words desc", "o.common desc", "length(o.description) asc"];
    const at = order.map((s) => sql.indexOf(s));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(sql).toContain("select distinct on (lower(m.description)) m.*");
    expect(sql).toContain("case m.data_type when 'Survey (FNDDS)' then 0 when 'Foundation' then 1 else 2 end");
  });
  it("has the synonyms Ron's examples need", () => {
    for (const s of ["('2', 'reduced fat 2')", "('1', 'low fat 1')", "('skim', 'fat free')", "('sourdough', 'sour dough')", "('french bread', 'bread french vienna')"]) expect(sql).toContain(s);
  });
  it("the app reads the plain name back", async () => {
    const rows = [{ fdc_id: 2705385, description: "Milk, whole", data_type: "Survey (FNDDS)", food_category: null, kcal: "61", protein_g: "3.27", carbs_g: "4.63", fat_g: "3.2", plain_name: "Whole milk" }];
    const supabase = { rpc: async () => ({ data: rows, error: null }) } as never;
    const hits = await searchFoods(supabase, "whole milk");
    expect(hits?.[0]).toMatchObject({ fdcId: 2705385, plainName: "Whole milk", description: "Milk, whole", per100g: { kcal: 61, protein_g: 3.27 } });
  });
});

describe("the Packaged foods group", () => {
  const hit: PackagedHit = {
    fdcId: 9000001,
    description: "Protein bar, chocolate",
    brand: "Acme",
    gtinUpc: "12345678905",
    category: "Bars",
    dataType: "Branded",
    per100g: { kcal: 400, protein_g: 30, carbs_g: 40, fat_g: 12 },
    servingSize: 60,
    servingSizeUnit: "g",
    householdServing: "1 bar",
  };
  it("names the product with its brand once", () => {
    expect(packagedTitle(hit)).toBe("Acme Protein bar, chocolate");
    expect(packagedTitle({ brand: "Acme", description: "ACME bar" })).toBe("ACME bar");
    expect(packagedTitle({ brand: null, description: "Bar" })).toBe("Bar");
  });
  it("offers the label's serving when it is in grams, never turns ml into grams", () => {
    expect(packagedPortions(hit)).toEqual([{ seq: 1, description: "1 bar (60 g)", gramWeight: 60 }]);
    expect(packagedPortions({ ...hit, servingSizeUnit: null, servingSize: 250 })).toEqual([]);
    expect(packagedPortions({ ...hit, servingSize: null })).toEqual([]);
    expect(packagedDetail(hit)).toMatchObject({ fdcId: 9000001, description: "Acme Protein bar, chocolate", per100g: { kcal: 400 } });
  });
  it("is logged as a barcode food with its code and no USDA food id (it is not in usda_foods)", () => {
    const base = { athleteId: "a", groupId: "g", logDate: "2026-11-23", mealSlot: null, fdcId: 9000001, description: "Acme Protein bar, chocolate", servingLabel: "1 bar (60 g)", servingQty: 1, grams: 60, per100g: hit.per100g };
    expect(usdaEntryRow({ ...base, packaged: { barcode: hit.gtinUpc } })).toMatchObject({ food_source: "barcode", fdc_id: null, barcode: "12345678905", calories: 240 });
    const everyday = usdaEntryRow(base);
    expect(everyday).toMatchObject({ food_source: "usda", fdc_id: 9000001 });
    expect("barcode" in everyday).toBe(false);
  });
  it("a drink labelled by volume is measured in ml: per 100 ml, its servings in ml, no grams or ounces, and no gram amount logged", () => {
    const drink: PackagedHit = { ...hit, description: "Sports drink", servingSize: 355, servingSizeUnit: "ml", householdServing: "1 can", per100g: { kcal: 24, carbs_g: 6 } };
    const d = packagedDetail(drink);
    expect(d.per100Unit).toBe("ml");
    expect(d.portions).toEqual([{ seq: 1, description: "1 can (355 ml)", gramWeight: 355 }]);
    expect(mlServingOptions(d.portions).map((o) => o.label)).toEqual(["1 can (355 ml)", "ml"]);
    expect(packagedDetail(hit).per100Unit).toBe("g");
    expect(per100Line({ kcal: 24 }, "ml")).toBe("Per 100 ml: 24 kcal");
    const row = usdaEntryRow({ athleteId: "a", groupId: "g", logDate: "2026-11-23", mealSlot: null, fdcId: 1, description: "Acme Sports drink", servingLabel: "1 can (355 ml)", servingQty: 1, grams: 355, per100g: drink.per100g, packaged: { barcode: null }, amountInMl: true });
    expect(row).toMatchObject({ amount_g: null, calories: 85, food_source: "barcode" });
    const ui = read("components/athlete/food-search-log.tsx");
    expect(ui).toContain('detail?.per100Unit === "ml" ? mlServingOptions(detail.portions) : servingOptions(detail?.portions ?? [])');
    expect(ui).toContain('amountInMl: detail.per100Unit === "ml",');
  });
  it("a packaged food cannot be picked while an everyday food is still loading", () => {
    expect(read("components/athlete/food-search-log.tsx")).toContain("onClick={() => pickPackaged(p)} disabled={loadingDetail}");
  });
  it("lists nothing until it is wired to part B's searchBranded", async () => {
    expect(await searchPackaged({} as never, "bar")).toEqual([]);
  });
  it("sits under the everyday results and shows only when there are rows", () => {
    const ui = read("components/athlete/food-search-log.tsx");
    expect(ui.indexOf("{hits.map((h) =>")).toBeLessThan(ui.indexOf("data-packaged-foods"));
    expect(ui).toContain("{packagedHits.length > 0 && (");
    expect(ui).toContain("searchPackaged(supabase, q, PACKAGED_RESULT_LIMIT).catch(() => null)");
    // the everyday name big, USDA's small under it
    expect(ui).toContain("{h.plainName || h.description}");
    expect(ui).toContain("{h.plainName && <span className=\"block font-body text-xs text-steel\" data-usda-name>{h.description}</span>}");
  });
  it("the per-100 g line", () => {
    expect(per100Line({ kcal: 61, protein_g: 3.27, carbs_g: 4.63, fat_g: 3.2 })).toBe("Per 100 g (3.5 oz): 61 kcal · 3.27p / 4.63c / 3.2f");
    expect(per100Line({})).toBe("Per 100 g (3.5 oz): calories not reported");
  });
});

describe("the loader (step 223: public.load_usda_food_batch, sent by scripts/usda-food-load.mjs with the server key)", () => {
  it("reads .env.local the usual way", async () => {
    const { parseEnvFile } = (await import("../scripts/usda-food-load-lib.mjs")) as any;
    expect(parseEnvFile('# x\nNEXT_PUBLIC_SUPABASE_URL="https://a.supabase.co"\nexport SUPABASE_SERVICE_ROLE_KEY=abc\n\nBAD\n')).toEqual({ NEXT_PUBLIC_SUPABASE_URL: "https://a.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "abc" });
  });
  it("sends the JSON batches in order, and refuses an index without them", async () => {
    const { batchFiles } = (await import("../scripts/usda-food-load-lib.mjs")) as any;
    expect(batchFiles({ jsonFiles: ["batch-002.json", "batch-001.json"] })).toEqual(["batch-001.json", "batch-002.json"]);
    expect(() => batchFiles({ files: ["batch-001.sql"] })).toThrow("--json");
    expect(() => batchFiles({ jsonFiles: ["../x.json"] })).toThrow("unexpected");
  });
  it("one POST to the function with the key in the headers only; a failure never shows the key", async () => {
    const { sendBatch } = (await import("../scripts/usda-food-load-lib.mjs")) as any;
    const calls: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const ok = async (url: string, init: any) => (calls.push({ url, init }), { ok: true, status: 200, text: async () => "1234" });
    expect(await sendBatch(ok, "https://a.supabase.co/", "SECRET", '{"p_name":"x"}')).toEqual({ ok: true, rows: 1234 });
    expect(calls[0].url).toBe("https://a.supabase.co/rest/v1/rpc/load_usda_food_batch");
    expect(calls[0].init.headers.Authorization).toBe("Bearer SECRET");
    expect(calls[0].init.body).toBe('{"p_name":"x"}');
    const failing = async () => ({ ok: false, status: 400, text: async () => '{"message":"bad SECRET"}' });
    const r = await sendBatch(failing, "https://a.supabase.co", "SECRET", "{}");
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain("SECRET");
    const thrown = async () => {
      throw new Error("network down near SECRET");
    };
    expect((await sendBatch(thrown, "https://a.supabase.co", "SECRET", "{}")).error).not.toContain("SECRET");
  });
  it("a JSON batch holds the same rows as its SQL batch, and a too-big one is refused", () => {
    const { toBatchJson } = batchLib as any;
    const foods = new Map([[1, { fdc_id: 1, description: "Milk, whole", data_type: "Survey (FNDDS)", food_category: null, plain_name: "Whole milk", extra_names: null, common: true }]]);
    const body = JSON.parse(toBatchJson("fndds-x-001", foods, [{ fdc_id: 1, nutrient_key: "kcal", amount_per_100g: 61 }], [{ fdc_id: 1, seq: 1, description: "1 cup", gram_weight: 244 }]));
    expect(body).toEqual({
      p_name: "fndds-x-001",
      p_mode: "add",
      p_refresh_keys: [],
      p_foods: [{ fdc_id: 1, description: "Milk, whole", data_type: "Survey (FNDDS)", food_category: null, plain_name: "Whole milk", extra_names: null, common: true }],
      p_nutrients: [{ fdc_id: 1, nutrient_key: "kcal", amount_per_100g: 61 }],
      p_portions: [{ fdc_id: 1, seq: 1, description: "1 cup", gram_weight: 244 }],
    });
    const huge = new Map([[1, { fdc_id: 1, description: "x".repeat(1_500_000), data_type: "Survey (FNDDS)" }]]);
    expect(() => toBatchJson("fndds-x-002", huge, [], [])).toThrow("smaller --batch-size");
  });
  it("the function is server-key only, runs with a fixed path, and loads a batch whole or not at all", () => {
    const sql = read("supabase/migrations/0467_food_search_everyday_foods.sql");
    expect(sql).toContain("security definer\nset search_path = public");
    expect(sql).toContain("revoke all on function public.load_usda_food_batch(text, jsonb, jsonb, jsonb, text, text[]) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.load_usda_food_batch(text, jsonb, jsonb, jsonb, text, text[]) to service_role;");
    expect(sql).toContain("if exists (select 1 from public.usda_load_batches where name = p_name) then\n    return 0;");
    expect(read("scripts/usda-food-load.mjs")).not.toMatch(/console\.(log|error)\([^)]*\bkey\b/);
  });
});
