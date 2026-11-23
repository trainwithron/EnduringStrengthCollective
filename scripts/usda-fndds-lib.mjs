// The everyday foods (USDA FNDDS, the "Survey (FNDDS)" foods in FoodData Central): the name a person says, and the other names USDA lists for a food. Pure, so it can be tested.
// Used by scripts/usda-import.mjs together with scripts/usda-lib.mjs (step 223, Ron Nov 23: "type whole milk and get whole milk").
//
// A plain name is only ever a re-wording of USDA's own name: it never adds a fact USDA did not give, and USDA's own name is always shown under it.

// The common foods named by hand, by USDA's exact description. `name` is what shows big; `common` puts the food first among equally good matches (the one a person most likely means
// when they type just the food). A description that is not in the files simply matches nothing (the import reports which, so the list can be corrected for a new release).
export const PLAIN_NAME_OVERRIDES = {
  "Milk, whole": { name: "Whole milk", common: true },
  "Milk, reduced fat (2%)": { name: "2% milk", common: true },
  "Milk, low fat (1%)": { name: "1% milk", common: true },
  "Milk, fat free (skim)": { name: "Skim milk", common: true },
  "Bread, sour dough": { name: "Sourdough bread", common: true },
  "Bread, French or Vienna": { name: "French bread", common: true },
  "Bread, white": { name: "White bread", common: true },
  "Bread, whole wheat": { name: "Whole wheat bread", common: true },
  "Chicken breast, baked, broiled, or roasted, skin not eaten, from raw": { name: "Chicken breast, cooked (no skin)", common: true },
  "Rice, white, cooked, no added fat": { name: "White rice, cooked", common: true },
  "Rice, brown, cooked, no added fat": { name: "Brown rice, cooked", common: true },
  "Egg, whole, boiled or poached": { name: "Boiled egg", common: true },
  "Egg, whole, fried no added fat": { name: "Fried egg", common: true },
  "Egg omelet or scrambled egg, NS as to fat": { name: "Scrambled eggs or omelet", common: true },
  "Banana, raw": { name: "Banana", common: true },
  "Apple, raw": { name: "Apple", common: true },
  "Orange, raw": { name: "Orange", common: true },
  "Peanut butter": { name: "Peanut butter", common: true },
  "Oatmeal, regular or quick, made with water, no added fat": { name: "Oatmeal, made with water", common: true },
  "Yogurt, Greek, nonfat milk, plain": { name: "Greek yogurt, plain, nonfat", common: true },
  // USDA files fish as "Fish, salmon, ..." and potatoes by how they are cooked: the everyday one gets the name people type
  "Fish, salmon, baked or broiled": { name: "Salmon, cooked", common: true },
  "Fish, tuna, canned": { name: "Canned tuna", common: true },
  "Potato, baked, peel not eaten": { name: "Baked potato", common: true },
  "Sweet potato, baked, no added fat": { name: "Baked sweet potato", common: true },
  "Broccoli, raw": { name: "Broccoli", common: true },
  "Avocado, raw": { name: "Avocado", common: true },
  "Beef, ground": { name: "Ground beef", common: true },
  "Turkey, ground": { name: "Ground turkey", common: true },
  // read against the real list (Spot Commander, Nov 23): the rule would word these badly
  "Liver, paste or pate": { name: "Liver pâté" },
  "Queso Anejo, aged Mexican cheese": { name: "Queso añejo" },
  "Firni, Indian pudding": { name: "Firni (Indian pudding)" },
  "Cheese spread, pressurized can": { name: "Spray cheese spread" },
};

// Second parts that are not a kind of the food ("Soup, NS as to type" and "Milk, NFS" say nothing; "Hamburger, on bun" is not an "On bun hamburger"): never moved in front.
const NOT_A_KIND = /^(ns |ns$|nfs|not |from |made with|with |without |no |on |in |and |or |as |for use|raw$|prepared|ready-to|canned$|frozen$|baby food)/i;

// The fruit and vegetable categories (WWEIA, as named in wweia_food_category.csv): only there is ", raw" dropped ("Banana, raw" is just a banana). Raw meat or fish keeps USDA's
// name, so a diary never hides that it was raw.
export const FRUIT_AND_VEGETABLE_CATEGORIES = new Set([
  "Apples", "Bananas", "Grapes", "Peaches and nectarines", "Strawberries", "Blueberries and other berries", "Citrus fruits", "Melons", "Dried fruits", "Other fruits and fruit salads",
  "Pears", "Pineapple", "Mango and papaya", "Tomatoes", "Carrots", "Other red and orange vegetables", "Broccoli", "Spinach", "Lettuce and lettuce salads",
  "Other dark green vegetables", "String beans", "Cabbage", "Onions", "Corn", "Other starchy vegetables", "Other vegetables and combinations",
]);
// Words that make a second part a description, not a kind ("cheese only", "vegetarian with egg", "round ball"): left as USDA wrote it.
const NOT_A_KIND_ANYWHERE = /\b(nfs|ns|with|without|only|ball|style|type|flavor|flavors)\b/i;

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// The rule, for a description with no hand-made name: "Milk, whole" -> "Whole milk"; "Bread, white" -> "White bread"; "Pear, raw" -> "Pear" (a fruit or vegetable only). Only a
// two-part name whose first part is one or two words and whose second is a short describing word or two is turned round; anything longer stays as USDA wrote it (moving words around
// a long name changes its sense). `category` is the food's WWEIA category. Returns null when the plain name would only repeat USDA's.
//
// Read against the real list (Spot Commander, Nov 23):
//   * a meat or poultry species first and a cut second keeps the order ("Pork, tenderloin" -> "Pork tenderloin", not "Tenderloin pork"), unless the second part is how it is
//     prepared ("Beef, corned" -> "Corned beef", "Duck, Peking" -> "Peking duck");
//   * "Fish, X" is just X when X is the fish ("Fish, carp" -> "Carp"), and "Fish baked"-style preparations turn round as usual;
//   * a second part that is the thing itself keeps the order ("Crab, cake" -> "Crab cake", "Fish, stick" -> "Fish stick");
//   * "sour dough" is written "sourdough" in every plain name.
export const MEAT_SPECIES = new Set(["beef", "pork", "lamb", "veal", "venison", "chicken", "turkey", "duck", "goat", "bison", "ham"]);
export const PREPARATION_WORDS = new Set(["ground", "roast", "corned", "cooked", "fried", "grilled", "breaded", "stewed", "sauteed", "rotisserie", "baked", "broiled", "smoked", "canned", "dried", "peking"]);
export const THING_ITSELF = new Set(["cake", "cake or patty", "patty", "stick", "sticks", "nuggets"]);

const finish = (name, desc) => {
  const n = name.replace(/sour dough/gi, (m) => (m[0] === "S" ? "Sourdough" : "sourdough")).trim();
  return n && n.length <= 120 && n !== desc ? n : null;
};

export function plainNameFor(description, category = null) {
  const desc = String(description ?? "").trim();
  if (!desc) return null;
  const override = PLAIN_NAME_OVERRIDES[desc];
  if (override) return override.name === desc ? null : override.name;
  const parts = desc.split(",").map((s) => s.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [food, kind] = parts;
  if (/^raw$/i.test(kind)) return FRUIT_AND_VEGETABLE_CATEGORIES.has(String(category ?? "")) && food.split(/\s+/).length <= 3 ? finish(capitalize(food), desc) : null;
  if (kind.split(/\s+/).length > 3 || NOT_A_KIND.test(kind) || NOT_A_KIND_ANYWHERE.test(kind) || /[()]/.test(kind)) return null;
  const foodLower = food.toLowerCase();
  const kindLower = kind.toLowerCase();
  const prepared = kindLower.split(/\s+/).some((w) => PREPARATION_WORDS.has(w));
  // the thing itself: the order stays
  if (THING_ITSELF.has(kindLower) && food.split(/\s+/).length <= 2) return finish(`${food} ${kindLower}`, desc);
  // "Fish, carp" is a carp
  if (foodLower === "fish" && !prepared) return finish(capitalize(kind), desc);
  // a species and its cut: the order stays ("Pork tenderloin")
  if (MEAT_SPECIES.has(foodLower) && !prepared) return finish(`${food} ${kindLower}`, desc);
  if (food.split(/\s+/).length > 2) return null;
  // a word of the food repeated in the kind ("Cheese spread, cream cheese") reads badly turned round
  const foodWords = new Set(foodLower.split(/\s+/));
  if (kindLower.split(/\s+/).some((w) => foodWords.has(w))) return null;
  return finish(capitalize(`${kind} ${foodLower}`), desc);
}

export const isCommonFood = (description) => PLAIN_NAME_OVERRIDES[String(description ?? "").trim()]?.common === true;

// USDA's "additional descriptions" (food_attribute.csv; the type is named in food_attribute_type.csv, "Additional Description", id 1001 in the current files): the other names a food goes
// by ("sourdough", "2% milk"), kept so a search finds them. Returns Map fdc_id -> "name; name; ..." (at most 4,000 characters), for the foods kept.
export const ADDITIONAL_DESCRIPTION_TYPE = "Additional Description";

export function buildExtraNames(attributeRows, attributeTypeRows, foods) {
  const typeIds = new Set(attributeTypeRows.filter((t) => String(t.name ?? "").trim().toLowerCase() === ADDITIONAL_DESCRIPTION_TYPE.toLowerCase()).map((t) => String(t.id)));
  if (typeIds.size === 0) typeIds.add("1001");
  const byFood = new Map();
  for (const r of attributeRows) {
    const fdcId = Number(r.fdc_id);
    if (!foods.has(fdcId) || !typeIds.has(String(r.food_attribute_type_id))) continue;
    // USDA puts the words in `value` (and sometimes in `name`); either is taken, each name once
    for (const raw of [r.value, r.name]) {
      const text = String(raw ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.toLowerCase() === ADDITIONAL_DESCRIPTION_TYPE.toLowerCase()) continue;
      const list = byFood.get(fdcId) ?? [];
      if (!list.some((x) => x.toLowerCase() === text.toLowerCase())) list.push(text);
      byFood.set(fdcId, list);
    }
  }
  const out = new Map();
  for (const [fdcId, list] of byFood) {
    let joined = "";
    for (const t of list) {
      const next = joined ? `${joined}; ${t}` : t;
      if (next.length > 4000) break;
      joined = next;
    }
    if (joined) out.set(fdcId, joined);
  }
  return out;
}

// Adds plain_name, common and extra_names to each FNDDS food (other foods are left as they are: their columns stay empty). Returns the overrides that matched no food, so the import can say so.
export function addEverydayNames(foods, extraNames = new Map()) {
  const seen = new Set();
  for (const f of foods.values()) {
    if (f.data_type !== "Survey (FNDDS)") continue;
    f.plain_name = plainNameFor(f.description, f.food_category);
    f.common = isCommonFood(f.description);
    if (PLAIN_NAME_OVERRIDES[f.description]) seen.add(f.description);
    f.extra_names = extraNames.get(f.fdc_id) ?? null;
  }
  return Object.keys(PLAIN_NAME_OVERRIDES).filter((d) => !seen.has(d));
}
