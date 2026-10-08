// Household measures for the gram amounts on a meal plan (pure). The plan's grams are the numbers the checks and the macros use; this turns a gram amount into "about 3/4 cup" for a
// food it knows, by a fixed table of USDA household weights (never typed by an AI). A food the table does not know, or an amount that does not come out close to a sensible
// measure (within 15 percent), shows grams only: a wrong "1 cup" next to an allergen-safe plan is worse than honest grams.
//
// Nothing stored changes. A plan keeps its lines as they were written; the measure is added when a line is shown (components/shared/ingredient-line.tsx).

export type PortionUnits = "household" | "grams";

interface Entry {
  id: string;
  match: RegExp;
  exclude?: RegExp;
  // Grams in one cup (a volume food) or in one piece (a counted food).
  cupG?: number;
  pieceG?: number;
  pieceName?: [string, string];
  // A volume food that is also measured in spoons when the amount is under a quarter cup (oats, oil, nut butter, seeds). Bulk foods (greens, fruit) are cups only.
  spoons?: boolean;
  // A small piece that is counted in whole numbers (an almond), not in quarters (an apple).
  whole?: boolean;
}

// More specific entries come first: the first match wins. Weights are the USDA "1 cup" or "1 medium" household weights (SR Legacy / Foundation), rounded.
const TABLE: Entry[] = [
  // dairy and eggs
  { id: "greek_yogurt", match: /greek yogurt|\byogurt\b/, cupG: 245 },
  { id: "cottage_cheese", match: /cottage cheese/, cupG: 226 },
  { id: "milk", match: /\b(skim|nonfat|fat-free|low-fat|whole|2%|1%) milk\b|^milk\b/, exclude: /almond|oat|soy|coconut|cashew|powder/, cupG: 245 },
  { id: "egg_whites_liquid", match: /liquid egg white|egg white.*liquid|^egg whites?$/, cupG: 243, spoons: true },
  { id: "egg_white_cooked", match: /(hard[- ]?boiled|boiled|cooked) egg whites?/, pieceG: 33, pieceName: ["egg white", "egg whites"], whole: true },
  { id: "shredded_cheese", match: /shredded (cheddar|mozzarella|cheese)|\bcheese \(shredded\)/, cupG: 113 },

  // grains and starches
  { id: "cream_of_rice", match: /cream of rice/, cupG: 180, spoons: true },
  { id: "rice_cooked", match: /\brice\b.*\bcooked\b|\bcooked\b.*\brice\b/, exclude: /cream of rice|rice cake/, cupG: 158 },
  { id: "rice_dry", match: /\brice\b.*\b(dry|raw|uncooked)\b|\b(dry|raw|uncooked)\b.*\brice\b/, exclude: /cream of rice|rice cake/, cupG: 185, spoons: true },
  { id: "quinoa_cooked", match: /quinoa.*cooked|cooked.*quinoa/, cupG: 185 },
  { id: "quinoa_dry", match: /quinoa/, cupG: 170, spoons: true },
  { id: "oatmeal_cooked", match: /(oatmeal|oats).*cooked|cooked.*(oatmeal|oats)|^oatmeal$/, cupG: 234 },
  { id: "oats_dry", match: /rolled oats|oats|oat flakes/, exclude: /cooked|milk|flour|bar/, cupG: 81, spoons: true },
  { id: "corn_flakes", match: /corn flakes|cornflakes/, cupG: 28 },
  { id: "pasta_cooked", match: /(pasta|spaghetti|penne|macaroni|noodles?).*cooked|cooked.*(pasta|spaghetti|penne|macaroni|noodles?)/, cupG: 140 },
  { id: "black_beans", match: /black beans/, cupG: 172 },
  { id: "kidney_beans", match: /kidney beans|pinto beans|white beans|navy beans/, cupG: 177 },
  { id: "chickpeas", match: /chickpeas|garbanzo/, cupG: 164 },
  { id: "lentils_cooked", match: /lentils/, cupG: 198 },
  { id: "sweet_potato", match: /sweet potato/, cupG: 133 },
  { id: "potato_raw", match: /potato/, exclude: /sweet/, cupG: 150 },

  // vegetables
  { id: "asparagus", match: /asparagus/, cupG: 134 },
  { id: "spinach", match: /spinach/, cupG: 30 },
  { id: "kale", match: /\bkale\b/, cupG: 21 },
  { id: "broccoli", match: /broccoli/, cupG: 91 },
  { id: "cauliflower", match: /cauliflower/, cupG: 107 },
  { id: "carrots_shredded", match: /carrots? \(shredded\)|shredded carrots?/, cupG: 110 },
  { id: "carrots", match: /carrots?/, cupG: 128 },
  { id: "bell_pepper_sliced", match: /bell peppers? \(sliced\)|sliced bell peppers?/, cupG: 92 },
  { id: "bell_pepper", match: /bell peppers?/, cupG: 149 },
  { id: "cabbage", match: /cabbage/, cupG: 70 },
  { id: "zucchini", match: /zucchini/, cupG: 113 },
  { id: "beets", match: /\bbeets?\b/, cupG: 136 },
  { id: "green_beans", match: /green beans/, cupG: 100 },
  { id: "cucumber", match: /cucumber/, cupG: 104 },
  { id: "mushrooms", match: /mushrooms?/, cupG: 70 },
  { id: "cherry_tomatoes", match: /cherry tomatoes|grape tomatoes/, cupG: 149 },
  { id: "romaine", match: /romaine|mixed greens|salad greens/, cupG: 47 },
  { id: "onion", match: /\bonions?\b/, exclude: /powder/, cupG: 160 },
  { id: "brussels_sprouts", match: /brussels sprouts/, cupG: 88 },

  // fruit
  { id: "banana_slices", match: /banana slices|sliced banana/, cupG: 150 },
  { id: "banana", match: /\bbananas?\b/, pieceG: 118, pieceName: ["banana", "bananas"] },
  { id: "berries", match: /mixed berries|fresh berries|berry/, cupG: 145 },
  { id: "strawberries", match: /strawberr/, cupG: 152 },
  { id: "raspberries", match: /raspberr/, cupG: 123 },
  { id: "blueberries", match: /blueberr/, cupG: 148 },
  { id: "cherries", match: /cherries/, cupG: 154 },
  { id: "cantaloupe", match: /cantaloupe/, cupG: 160 },
  { id: "honeydew", match: /honeydew/, cupG: 170 },
  { id: "watermelon", match: /watermelon/, cupG: 152 },
  { id: "mango", match: /mango/, cupG: 165 },
  { id: "peaches", match: /peach/, cupG: 154 },
  { id: "pineapple", match: /pineapple/, cupG: 165 },
  { id: "plums", match: /\bplums?\b/, pieceG: 66, pieceName: ["plum", "plums"] },
  { id: "kiwi", match: /\bkiwi/, pieceG: 69, pieceName: ["kiwi", "kiwis"] },
  { id: "grapefruit", match: /grapefruit/, pieceG: 246, pieceName: ["grapefruit", "grapefruits"] },
  { id: "apple", match: /\bapples?\b/, pieceG: 182, pieceName: ["apple", "apples"] },
  { id: "pear", match: /\bpears?\b/, pieceG: 178, pieceName: ["pear", "pears"] },
  { id: "orange", match: /\boranges?\b/, exclude: /juice/, pieceG: 131, pieceName: ["orange", "oranges"] },
  { id: "avocado", match: /avocado/, cupG: 230, spoons: true },

  // nuts, seeds, spreads, sweeteners, fats
  { id: "almonds_sliced", match: /sliced almonds/, cupG: 92, spoons: true },
  { id: "almonds", match: /almonds/, pieceG: 1.2, pieceName: ["almond", "almonds"], whole: true },
  { id: "walnuts_chopped", match: /chopped walnuts/, cupG: 117, spoons: true },
  { id: "walnuts", match: /walnuts/, pieceG: 2.5, pieceName: ["walnut half", "walnut halves"], whole: true },
  { id: "macadamia", match: /macadamia/, pieceG: 2.6, pieceName: ["macadamia nut", "macadamia nuts"], whole: true },
  { id: "pumpkin_seeds", match: /pumpkin seeds/, cupG: 129, spoons: true },
  { id: "chia", match: /chia/, cupG: 192, spoons: true },
  { id: "nut_butter", match: /nut butter|peanut butter|almond butter/, cupG: 258, spoons: true },
  { id: "hummus", match: /hummus/, cupG: 246, spoons: true },
  { id: "honey", match: /\bhoney\b/, cupG: 339, spoons: true },
  { id: "maple_syrup", match: /maple syrup/, cupG: 322, spoons: true },
  { id: "olive_oil", match: /olive oil|sesame oil|avocado oil|coconut oil|\boil\b/, cupG: 216, spoons: true },
  { id: "butter", match: /\bbutter\b/, exclude: /nut|peanut|almond/, cupG: 227, spoons: true },
];

// Foods the table deliberately leaves to grams, with the reason. A test checks every food the starter library prints is either in the table or here, so a new food cannot be
// forgotten without a decision. Meat, fish and tofu already print ounces; protein powders vary by brand and tub; a line with its own count (eggs, slices, wraps) needs none.
export const GRAMS_ONLY_ON_PURPOSE: { match: RegExp; why: string }[] = [
  { match: /beef|steak|sirloin|chuck|flank|ny strip|pork|chicken|turkey|salmon|shrimp|fish|cod|tuna|jerky/, why: "meat and fish: grams and ounces are the honest measure" },
  { match: /tofu|tempeh|seitan/, why: "soy and wheat proteins: grams and ounces" },
  { match: /whey|casein|plant protein|protein (shake|isolate)/, why: "scoop sizes vary by brand" },
  { match: /preparation/, why: "a note, not a food" },
];

const LABEL_PAREN_NOISE = /[’']/g;
const normalizeLabel = (label: string): string => label.toLowerCase().replace(LABEL_PAREN_NOISE, "").replace(/\s+/g, " ").trim();

function entryFor(label: string): Entry | null {
  const l = normalizeLabel(label);
  for (const e of TABLE) {
    if (e.match.test(l) && !(e.exclude && e.exclude.test(l))) return e;
  }
  return null;
}

// "1 1/2", "3/4", "2".
const FRACTION_TEXT: Record<number, string> = { 0: "", 0.25: "1/4", [1 / 3]: "1/3", 0.5: "1/2", [2 / 3]: "2/3", 0.75: "3/4" };
const CUP_FRACTIONS = [0, 0.25, 1 / 3, 0.5, 2 / 3, 0.75];
const HALF_FRACTIONS = [0, 0.5];
const QUARTER_FRACTIONS = [0, 0.25, 0.5, 0.75];

// The nearest value of the form whole + one of the allowed fractions.
function nearest(x: number, fractions: number[]): number {
  let best = Math.round(x);
  let bestErr = Math.abs(x - best);
  const whole = Math.floor(x);
  for (const w of [whole, whole + 1]) {
    for (const f of fractions) {
      const v = w + f;
      const err = Math.abs(x - v);
      if (err < bestErr - 1e-9) {
        best = v;
        bestErr = err;
      }
    }
  }
  return best;
}

function fmt(v: number): string {
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  const key = Object.keys(FRACTION_TEXT)
    .map(Number)
    .find((k) => Math.abs(k - frac) < 1e-6);
  const fracText = key !== undefined ? FRACTION_TEXT[key] : "";
  if (whole === 0) return fracText || "0";
  return fracText ? `${whole} ${fracText}` : String(whole);
}

const withinTolerance = (shownG: number, grams: number): boolean => grams > 0 && Math.abs(shownG - grams) / grams <= 0.15;

// A measure for an amount, or null when the food is unknown or no sensible measure lands within 15 percent of the weight.
export function householdMeasure(label: string, grams: number): string | null {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const e = entryFor(label);
  if (!e) return null;

  if (e.cupG) {
    const cups = grams / e.cupG;
    if (cups >= 0.25) {
      const v = nearest(cups, CUP_FRACTIONS);
      if (v >= 0.25 && withinTolerance(v * e.cupG, grams)) return `${fmt(v)} ${v > 1 ? "cups" : "cup"}`;
    }
    if (e.spoons) {
      const tbsp = cups * 16;
      if (tbsp >= 1) {
        const v = nearest(tbsp, HALF_FRACTIONS);
        if (v >= 1 && withinTolerance((v / 16) * e.cupG, grams)) return `${fmt(v)} tbsp`;
      }
      const tsp = cups * 48;
      if (tsp >= 0.5) {
        const v = nearest(tsp, HALF_FRACTIONS);
        if (v >= 0.5 && withinTolerance((v / 48) * e.cupG, grams)) return `${fmt(v)} tsp`;
      }
    }
    return null;
  }

  if (e.pieceG && e.pieceName) {
    const pieces = grams / e.pieceG;
    const v = e.whole || pieces >= 4 ? Math.round(pieces) : nearest(pieces, QUARTER_FRACTIONS);
    if (v >= (e.whole ? 1 : 0.25) && withinTolerance(v * e.pieceG, grams)) return `${fmt(v)} ${v > 1 ? e.pieceName[1] : e.pieceName[0]}`;
  }
  return null;
}

// "<strong>Label:</strong> 150g (~5.3 oz)" or "Label: 150g" or "<strong>Label:</strong> 150g [12g carbs]". The amount must be grams; counted lines (3 large, 2 tsp) are left alone.
const GRAM_LINE = /^(<strong>)?([^<:]+?):(<\/strong>)?(\s*)(\d+(?:\.\d+)?)\s*g\b(\s*\(~\s*([\d.]+\s*oz)\s*\))?(.*)$/i;

// Adds the household measure to a plan line when one is known. Grams first by default ("150g (~5.3 oz, about 1 cup)"); with units "household" the measure leads
// ("about 1 cup (150g, ~5.3 oz)"). A line with no gram amount, or a food with no sensible measure, comes back exactly as it was.
export function withHouseholdMeasure(line: string, units: PortionUnits = "grams"): string {
  const m = GRAM_LINE.exec(line);
  if (!m) return line;
  const [, open = "", label, close = "", space, gramsText, , ozText, rest] = m;
  const grams = Number(gramsText);
  const measure = householdMeasure(label, grams);
  if (!measure) return line;
  const gramsPart = `${gramsText}g`;
  if (units === "household") {
    const inner = ozText ? `${gramsPart}, ~${ozText.trim()}` : gramsPart;
    return `${open}${label}:${close}${space}about ${measure} (${inner})${rest}`;
  }
  const inner = ozText ? `~${ozText.trim()}, about ${measure}` : `about ${measure}`;
  return `${open}${label}:${close}${space}${gramsPart} (${inner})${rest}`;
}

// Which of these lines have a gram amount but no measure (for a coverage check and to grow the table from real plans).
export function gramsOnlyLabels(lines: string[]): string[] {
  const out = new Set<string>();
  for (const line of lines) {
    const m = GRAM_LINE.exec(line);
    if (!m) continue;
    if (!householdMeasure(m[2], Number(m[5]))) out.add(m[2].trim());
  }
  return [...out].sort();
}

// Whether the table knows this food at all (an amount can still come out as grams only when no measure is close).
export const knowsFood = (label: string): boolean => entryFor(label) !== null;
