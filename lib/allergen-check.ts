// Allergy and food-preference safety for meal text. Pure, no AI, no network: it reads ingredient lines (and option titles) and says which allergen, intolerance,
// dislike or diet rule a line breaks, so a plan can be filtered before a client ever sees it.
//
// How it matches. Text is lower-cased and reduced to words. A term matches as a WHOLE WORD (so "eggplant" is not "egg", "butternut" is not a nut, "buckwheat" is not
// "wheat"), and it is plural-aware ("eggs", "anchovies"). A short list of SAFE PHRASES is removed first, so "coconut milk" and "almond milk" are not dairy and
// "peanut butter" is not butter. An allergy is a hard drop, always. An intolerance or a dislike is also dropped from what a client is offered, but it is reported as a
// PREFERENCE, never as a safety hit. "May contain" and cross-contact are NOT modelled (the coach screen says so); this is a filter on what the text names, not a guarantee.

export type AllergenKey = "peanut" | "tree nut" | "dairy" | "egg" | "soy" | "wheat or gluten" | "fish" | "shellfish" | "sesame";

export const ALLERGEN_KEYS: AllergenKey[] = ["peanut", "tree nut", "dairy", "egg", "soy", "wheat or gluten", "fish", "shellfish", "sesame"];

export const ALLERGEN_TERMS: Record<AllergenKey, string[]> = {
  peanut: ["peanut", "arachis", "satay", "groundnut"],
  "tree nut": [
    "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia", "pine nut", "brazil nut", "chestnut", "pesto", "marzipan", "praline", "nutella",
    "nut butter", "nut milk", "gianduja",
  ],
  dairy: [
    "milk", "whey", "casein", "caseinate", "butter", "ghee", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "ricotta", "gouda", "brie", "mascarpone", "halloumi",
    "paneer", "yogurt", "yoghurt", "kefir", "skyr", "cream", "custard", "buttermilk", "lactose", "curd", "half and half", "ice cream",
  ],
  egg: ["egg", "albumin", "ovalbumin", "mayonnaise", "mayo", "aioli", "hollandaise", "meringue", "eggnog"],
  soy: ["soy", "soya", "soybean", "tofu", "tempeh", "edamame", "miso", "tamari", "teriyaki", "hoisin", "natto"],
  "wheat or gluten": [
    "wheat", "gluten", "flour", "bread", "breadcrumb", "pasta", "spaghetti", "macaroni", "noodle", "couscous", "semolina", "bulgur", "farro", "orzo", "panko", "tortilla",
    "barley", "rye", "seitan", "bagel", "pita", "naan", "cracker", "pretzel", "croissant", "udon", "ramen", "spelt", "kamut", "durum", "malt", "soy sauce",
    "toast", "sourdough", "baguette", "brioche", "ciabatta", "bun", "waffle", "pancake", "muffin", "biscuit",
  ],
  fish: [
    "fish", "salmon", "tuna", "cod", "tilapia", "halibut", "trout", "sardine", "anchovy", "mackerel", "haddock", "snapper", "mahi", "swordfish", "herring", "pollock",
    "catfish", "sea bass", "fish sauce", "worcestershire", "caesar",
  ],
  shellfish: ["shrimp", "prawn", "crab", "lobster", "mussel", "clam", "scallop", "oyster", "crawfish", "crayfish", "shellfish", "squid", "calamari", "octopus"],
  sesame: ["sesame", "tahini", "hummus", "halva"],
};

// Phrases that contain an allergen word but are NOT that allergen. Removed before matching that allergen.
export const SAFE_PHRASES: Partial<Record<AllergenKey, string[]>> = {
  dairy: [
    "coconut milk", "almond milk", "oat milk", "soy milk", "rice milk", "cashew milk", "hemp milk", "pea milk", "flax milk", "coconut cream", "coconut yogurt", "coconut yoghurt",
    "coconut butter", "peanut butter", "almond butter", "cashew butter", "nut butter", "sunflower butter", "sunflower seed butter", "seed butter", "apple butter", "cocoa butter",
    "shea butter", "cream of tartar", "coconut whipped cream", "oat cream", "soy yogurt", "almond yogurt", "plant milk", "plant based milk", "dairy free",
  ],
  egg: ["flax egg", "chia egg", "egg free", "egg replacer", "vegan mayo", "vegan mayonnaise", "eggless"],
  "wheat or gluten": [
    "almond flour", "coconut flour", "rice flour", "chickpea flour", "corn flour", "tapioca flour", "cassava flour", "buckwheat flour", "potato flour", "oat flour", "banana flour",
    "rice noodle", "rice noodles", "rice pasta", "corn tortilla", "corn tortillas", "rice cracker", "rice crackers", "glass noodle", "glass noodles", "soba",
  ],
  "tree nut": ["peanut butter", "butternut", "nutmeg", "water chestnut", "water chestnuts"],
  fish: ["fish free", "fishless"],
  soy: [],
};

// Meat and poultry words, for the diet rules (a vegetarian, vegan or pescatarian is never offered these).
const MEAT_TERMS = [
  "beef", "steak", "pork", "bacon", "ham", "sausage", "chicken", "turkey", "lamb", "veal", "duck", "venison", "bison", "prosciutto", "salami", "pepperoni", "jerky",
  "meatball", "brisket", "ribs", "hot dog", "meat", "gelatin", "lard", "tallow", "goose", "rabbit", "mutton", "chorizo", "pancetta",
];
const NOT_MEAT_MARKERS = ["plant based", "vegan", "meatless", "meat free", "vegetarian", "meat alternative", "veggie"];

// Words people type that mean one of the groups above ("lactose", "gluten", "tree nuts").
const ALIASES: Record<string, AllergenKey> = {
  peanut: "peanut", peanuts: "peanut",
  "tree nut": "tree nut", "tree nuts": "tree nut", nut: "tree nut", nuts: "tree nut",
  dairy: "dairy", milk: "dairy", lactose: "dairy",
  egg: "egg", eggs: "egg",
  soy: "soy", soya: "soy",
  gluten: "wheat or gluten", wheat: "wheat or gluten", "wheat or gluten": "wheat or gluten",
  fish: "fish",
  shellfish: "shellfish",
  sesame: "sesame",
};

export function normalizeText(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A whole-word, plural-aware matcher for one term over text already run through normalizeText (spaces on both ends).
function termRegex(term: string): RegExp {
  const t = normalizeText(term).trim();
  const body = t.endsWith("y") && t.length > 2 ? `${escapeRe(t.slice(0, -1))}(?:y|ies)` : `${escapeRe(t)}(?:s|es)?`;
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);
}

// Removes the safe phrases from already-normalized text, plural-aware like the terms ("chia egg" also removes "chia eggs").
function stripPhrases(normalized: string, phrases: string[]): string {
  let out = normalized;
  for (const p of phrases) out = out.replace(new RegExp(termRegex(p).source, "g"), " ");
  return out;
}

export interface AllergenHit {
  // 'allergy' is a safety hit; 'intolerance' and 'dislike' are preference hits; 'diet' is a diet-type rule.
  kind: "allergy" | "intolerance" | "dislike" | "diet";
  // What was declared (the allergen, the typed item, or the diet), for the message.
  label: string;
  // The word in the text that matched.
  matched: string;
  line: string;
}

function firstMatch(normalized: string, terms: string[]): string | null {
  for (const term of terms) {
    const m = termRegex(term).exec(normalized);
    if (m) return m[0].trim();
  }
  return null;
}

// Does this text name that allergen group?
export function textHasAllergen(text: string, key: AllergenKey): string | null {
  const normalized = stripPhrases(normalizeText(text), SAFE_PHRASES[key] ?? []);
  return firstMatch(normalized, ALLERGEN_TERMS[key]);
}

// An allergy item as stored: one of the controlled names, or "other: kiwi" free text.
function allergyTerms(item: string): { label: string; key: AllergenKey | null; terms: string[] } | null {
  const raw = item.trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("other:")) {
    const word = raw.slice("other:".length).trim();
    if (!word) return null;
    const key = ALIASES[word] ?? null;
    return key ? { label: word, key, terms: ALLERGEN_TERMS[key] } : { label: word, key: null, terms: [word] };
  }
  const key = (ALLERGEN_KEYS as string[]).includes(raw) ? (raw as AllergenKey) : ALIASES[raw] ?? null;
  return key ? { label: key, key, terms: ALLERGEN_TERMS[key] } : { label: raw, key: null, terms: [raw] };
}

// An intolerance or dislike is whatever the person typed; a known word ("lactose", "gluten") also covers its group.
function looseTerms(item: string): { label: string; key: AllergenKey | null; terms: string[] } | null {
  const raw = item.trim().toLowerCase();
  if (!raw) return null;
  const key = ALIASES[raw] ?? null;
  return key ? { label: raw, key, terms: ALLERGEN_TERMS[key] } : { label: raw, key: null, terms: [raw] };
}

export type DietType = "omnivore" | "vegetarian" | "vegan" | "pescatarian" | "carnivore" | "keto" | "paleo";

export interface FoodRules {
  allergies?: string[];
  intolerances?: string[];
  dislikes?: string[];
  dietType?: string | null;
}

function dietHit(normalized: string, dietType: string | null | undefined): { label: string; matched: string } | null {
  if (dietType !== "vegetarian" && dietType !== "vegan" && dietType !== "pescatarian") return null;
  // A line that says it is plant-based is not meat, whatever animal it is named after.
  const meatText = NOT_MEAT_MARKERS.some((m) => normalized.includes(` ${m} `)) ? "  " : normalized;
  const meat = firstMatch(meatText, MEAT_TERMS);
  if (meat) return { label: dietType, matched: meat };
  if (dietType === "vegetarian" || dietType === "vegan") {
    const fish = textHasAllergen(normalized, "fish") ?? textHasAllergen(normalized, "shellfish");
    if (fish) return { label: dietType, matched: fish };
  }
  if (dietType === "vegan") {
    const animal = textHasAllergen(normalized, "dairy") ?? textHasAllergen(normalized, "egg");
    if (animal) return { label: dietType, matched: animal };
  }
  return null;
}

// Every rule a set of text lines breaks. Each line is checked on its own, so the message can name the line.
export function checkLines(lines: string[], rules: FoodRules): AllergenHit[] {
  const hits: AllergenHit[] = [];
  const allergies = (rules.allergies ?? []).map(allergyTerms).filter((x): x is NonNullable<typeof x> => !!x);
  const intolerances = (rules.intolerances ?? []).map(looseTerms).filter((x): x is NonNullable<typeof x> => !!x);
  const dislikes = (rules.dislikes ?? []).map(looseTerms).filter((x): x is NonNullable<typeof x> => !!x);

  for (const line of lines) {
    if (!line || !line.trim()) continue;
    const base = normalizeText(line);
    const test = (entry: { label: string; key: AllergenKey | null; terms: string[] }, kind: AllergenHit["kind"]) => {
      const text = entry.key ? stripPhrases(base, SAFE_PHRASES[entry.key] ?? []) : base;
      const matched = firstMatch(text, entry.terms);
      if (matched) hits.push({ kind, label: entry.label, matched, line });
    };
    for (const a of allergies) test(a, "allergy");
    for (const i of intolerances) test(i, "intolerance");
    for (const d of dislikes) test(d, "dislike");
    const diet = dietHit(base, rules.dietType);
    if (diet) hits.push({ kind: "diet", label: diet.label, matched: diet.matched, line });
  }
  return hits;
}

export const hasSafetyHit = (hits: AllergenHit[]) => hits.some((h) => h.kind === "allergy");

// One plain sentence for a coach about a hit.
export function describeHit(h: AllergenHit): string {
  switch (h.kind) {
    case "allergy":
      return `contains ${h.matched} (allergy: ${h.label})`;
    case "intolerance":
      return `contains ${h.matched} (intolerance: ${h.label})`;
    case "dislike":
      return `contains ${h.matched} (a food they dislike: ${h.label})`;
    default:
      return `has ${h.matched}, which a ${h.label} client does not eat`;
  }
}
