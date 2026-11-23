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
  "Egg, whole, fried, no added fat": { name: "Fried egg", common: true },
  "Egg, whole, scrambled, no added fat": { name: "Scrambled eggs", common: true },
  "Banana, raw": { name: "Banana", common: true },
  "Apple, raw": { name: "Apple", common: true },
  "Orange, raw": { name: "Orange", common: true },
  "Peanut butter": { name: "Peanut butter", common: true },
  "Oatmeal, regular or quick, made with water, no added fat": { name: "Oatmeal, made with water", common: true },
  "Yogurt, Greek, plain, nonfat": { name: "Greek yogurt, plain, nonfat", common: true },
};

// Second parts that are not a kind of the food ("Banana, raw" is just a banana; "Soup, NS as to type" says nothing): never moved in front.
const NOT_A_KIND = /^(ns |not specified|from |made with|with |without |for use|raw$|prepared|ready-to|canned$|frozen$|baby food)/i;

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// The rule, for a description with no hand-made name: "Milk, whole" -> "Whole milk"; "Bread, white" -> "White bread"; "Banana, raw" -> "Banana". Only a two-part name whose first part
// is one or two words and whose second is a short describing word or two is turned round; anything longer stays as USDA wrote it (moving words around a long name changes its sense).
// Returns null when the plain name would only repeat USDA's.
export function plainNameFor(description) {
  const desc = String(description ?? "").trim();
  if (!desc) return null;
  const override = PLAIN_NAME_OVERRIDES[desc];
  if (override) return override.name === desc ? null : override.name;
  const parts = desc.split(",").map((s) => s.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [food, kind] = parts;
  if (/^raw$/i.test(kind) && food.split(/\s+/).length <= 3) return capitalize(food);
  if (food.split(/\s+/).length > 2 || kind.split(/\s+/).length > 3 || NOT_A_KIND.test(kind) || /[()]/.test(kind)) return null;
  const name = capitalize(`${kind} ${food.toLowerCase()}`);
  return name.length <= 120 ? name : null;
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
    f.plain_name = plainNameFor(f.description);
    f.common = isCommonFood(f.description);
    if (f.common) seen.add(f.description);
    f.extra_names = extraNames.get(f.fdc_id) ?? null;
  }
  return Object.keys(PLAIN_NAME_OVERRIDES).filter((d) => !seen.has(d));
}
