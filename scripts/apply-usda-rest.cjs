// Second USDA pass over the ported food table (Ron asked for the most accurate data for EVERY row, 2026-10-07). It reads scripts/usda-rest-data.json (key, USDA fdc id, protein /
// carbs / fat per 100 g, unit weight in grams for foods counted in whole units, USDA record name; all values read from the usda_foods / usda_food_nutrients records stored in this
// project) and rewrites those rows of lib/meal-templates/food-table.ts: per gram for most foods (per 100 g divided by 100), per unit for the foods counted in whole units
// (per 100 g times the unit weight). Rows not in the data file are left exactly as they are (supplements and powders with no stored record, branded cereals, mixed berries,
// edamame, seitan and the plant-protein blend; see the port log). Run once; it refuses to run twice.
const fs = require("fs");
const file = "lib/meal-templates/food-table.ts";
let s = fs.readFileSync(file, "utf8");
const data = JSON.parse(fs.readFileSync("scripts/usda-rest-data.json", "utf8"));
if (s.includes("// USDA fdc 171688")) throw new Error("The rest-of-table pass was already applied.");

const round = (n, d) => Number(n.toFixed(d));
const report = [];
for (const [key, fdc, p, c, f, unit, record] of data) {
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
  const conv = (per100) => (unit > 0 ? round((per100 * unit) / 100, 2) : round(per100 / 100, 4));
  const after = { protein: conv(p), carbs: conv(c), fat: conv(f) };
  // Physical bounds: per gram the three macros cannot weigh more than the food; per unit, more than the unit.
  const total = after.protein + after.carbs + after.fat;
  if (unit > 0 ? total > unit : total > 1.0005) throw new Error(`${key}: macros weigh more than the food (${total})`);
  const old = /\(was ([^)]*)\)/.exec(m[4]);
  const was = old ? old[1] : `${before.protein} / ${before.carbs} / ${before.fat}`;
  const body = order.map((k) => (k === "category" ? `category: ${category}` : `${k}: ${after[k]}`)).join(", ");
  s = s.replace(re, `${m[1]}{ ${body} }${m[3]} // USDA fdc ${fdc} (was ${was})`);
  report.push({ key, fdc, record, unit, per100: [p, c, f], before: [before.protein, before.carbs, before.fat], was, after: [after.protein, after.carbs, after.fat] });
}
fs.writeFileSync(file, s);
fs.writeFileSync(process.argv[2] || "usda-rest-report.json", JSON.stringify(report, null, 2));
console.log("corrected", report.length, "rows");
