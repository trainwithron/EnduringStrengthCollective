// One-time correction of the ported food table to USDA values (Ron approved this on 2026-10-07). It rewrites the numbers of the rows listed below in
// lib/meal-templates/food-table.ts and leaves every other row, and the recipe formulas, exactly as they were. Values are per gram for most foods; for the three foods counted in
// whole units (rice cake, whole-wheat bread, whole-wheat wrap) they are per unit (a 9 g cake, a 28 g slice, a 50 g wrap), computed from the USDA per-100-g record.
// Source: the USDA FoodData Central records stored in this project's usda_foods / usda_food_nutrients tables (fdc ids below). Run once; it refuses to run twice.
const fs = require("fs");
const file = "lib/meal-templates/food-table.ts";
let s = fs.readFileSync(file, "utf8");

// key, fdc id, USDA record, {protein, carbs, fat} AFTER (per gram or per unit as described above)
const FIXES = [
  ["rice_cake", 170250, "Snacks, rice cakes, brown rice, plain, unsalted (8.2 / 81.5 / 2.8 per 100 g, x 9 g a cake)", { protein: 0.74, carbs: 7.34, fat: 0.25 }],
  ["beef_jerky", 167536, "Snacks, beef jerky, chopped and formed", { protein: 0.332, carbs: 0.11, fat: 0.256 }],
  ["ribeye_steak", 173403, "Beef, rib eye steak, boneless, lip off, separable lean and fat, trimmed to 0\" fat, choice, raw", { protein: 0.187, carbs: 0, fat: 0.184 }],
  ["porterhouse", 168715, "Beef, short loin, porterhouse steak, separable lean and fat, trimmed to 1/8\" fat, choice, raw", { protein: 0.204, carbs: 0, fat: 0.146 }],
  ["ground_beef_90_10", 2514743, "Beef, ground, 90% lean meat / 10% fat, raw", { protein: 0.182, carbs: 0, fat: 0.129 }],
  ["chuck_roast", 168668, "Beef, chuck, arm pot roast, separable lean and fat, trimmed to 1/8\" fat, choice, raw", { protein: 0.191, carbs: 0, fat: 0.186 }],
  ["ground_turkey_93_7", 2514747, "Turkey, ground, 93% lean / 7% fat, raw", { protein: 0.173, carbs: 0, fat: 0.096 }],
  ["chicken_wing", 172390, "Chicken, broilers or fryers, wing, meat and skin, raw", { protein: 0.175, carbs: 0, fat: 0.129 }],
  ["pork_chop", 167829, "Pork, fresh, loin, center loin (chops), bone-in, separable lean only, raw (22.0 / 0 / 3.7)", { protein: 0.22, carbs: 0, fat: 0.037 }],
  ["shrimp_raw", 175179, "Crustaceans, shrimp, raw (20.1 / 0 / 0.5)", { protein: 0.201, carbs: 0, fat: 0.005 }],
  ["halibut", 174200, "Fish, halibut, Atlantic and Pacific, raw", { protein: 0.186, carbs: 0, fat: 0.013 }],
  ["scallops", 174220, "Mollusks, scallop, mixed species, raw", { protein: 0.121, carbs: 0.032, fat: 0.005 }],
  ["whole_wheat_bread", 335240, "Bread, whole-wheat, commercially prepared (12.3 / 43.1 / 3.6 per 100 g, x 28 g a slice)", { protein: 3.44, carbs: 12.07, fat: 1.01 }],
  ["whole_wheat_wrap", 174081, "Tortillas, ready-to-bake or -fry, whole wheat (9.8 / 45.9 / 9.8 per 100 g, x 50 g a wrap)", { protein: 4.9, carbs: 22.95, fat: 4.9 }],
  ["bran_flakes", 173888, "Cereals ready-to-eat, POST Bran Flakes", { protein: 0.099, carbs: 0.805, fat: 0.021 }],
  ["pumpkin_seeds", 170556, "Seeds, pumpkin and squash seed kernels, dried", { protein: 0.302, carbs: 0.107, fat: 0.491 }],
  ["walnuts_raw", 2346394, "Nuts, walnuts, English, halves, raw", { protein: 0.146, carbs: 0.109, fat: 0.697 }],
  ["kale_raw", 323505, "Kale, raw", { protein: 0.029, carbs: 0.044, fat: 0.015 }],
  ["grapefruit_raw", 174675, "Grapefruit, raw, pink and red, Florida", { protein: 0.006, carbs: 0.075, fat: 0.001 }],
  ["fennel_bulb_raw", 2747655, "Fennel, bulb, raw", { protein: 0.009, carbs: 0.055, fat: 0.001 }],
  ["nectarine_raw", 327357, "Nectarines, raw", { protein: 0.011, carbs: 0.092, fat: 0.003 }],
  ["applesauce_unsweet", 2263892, "Applesauce, unsweetened, with added vitamin C", { protein: 0.003, carbs: 0.123, fat: 0.002 }],
];

if (s.includes("// USDA fdc")) throw new Error("The food table already carries USDA corrections: not run again.");
const report = [];
for (const [key, fdc, record, after] of FIXES) {
  const re = new RegExp(`^(\\s+${key}:\\s*)\\{([^}]*)\\}(,?)(.*)$`, "m");
  const m = re.exec(s);
  if (!m) throw new Error("row not found: " + key);
  const props = m[2].split(",").map((x) => x.trim()).filter(Boolean).map((x) => x.split(":").map((y) => y.trim()));
  const before = {};
  const order = [];
  let category = null;
  for (const [k, v] of props) {
    order.push(k);
    if (k === "category") category = v;
    else before[k] = Number(v);
  }
  const body = order.map((k) => (k === "category" ? `category: ${category}` : `${k}: ${after[k]}`)).join(", ");
  s = s.replace(re, `${m[1]}{ ${body} }${m[3]} // USDA fdc ${fdc} (was ${before.protein} / ${before.carbs} / ${before.fat})`);
  report.push({ key, fdc, record, before: [before.protein, before.carbs, before.fat], after: [after.protein, after.carbs, after.fat] });
}
fs.writeFileSync(file, s);
fs.writeFileSync(process.argv[2] || "usda-corrections.json", JSON.stringify(report, null, 2));
console.log("corrected", report.length, "rows");
