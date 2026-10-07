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
  peanut: ["peanut", "arachis", "satay", "groundnut", "nut", "mixed nut", "trail mix", "nut butter"],
  "tree nut": [
    "almond", "walnut", "cashew", "pecan", "pistachio", "hazelnut", "macadamia", "pine nut", "brazil nut", "chestnut", "pesto", "marzipan", "praline", "nutella",
    "nut butter", "nut milk", "gianduja", "nut", "mixed nut", "trail mix", "filbert", "nougat", "amaretto", "orgeat", "frangipane", "baklava",
  ],
  dairy: [
    "milk", "whey", "casein", "caseinate", "butter", "ghee", "cheese", "cheddar", "mozzarella", "parmesan", "feta", "ricotta", "gouda", "brie", "mascarpone", "halloumi",
    "paneer", "yogurt", "yoghurt", "kefir", "skyr", "cream", "custard", "buttermilk", "lactose", "curd", "half and half", "ice cream",
    "queso", "provolone", "swiss", "gruyere", "pecorino", "romano", "alfredo", "bechamel", "tzatziki", "labneh", "quark", "creamer", "latte", "cappuccino", "gelato",
    "milk chocolate", "ranch", "cheesecake", "buttercream",
  ],
  egg: [
    "egg", "albumin", "ovalbumin", "mayonnaise", "mayo", "aioli", "hollandaise", "meringue", "eggnog", "omelet", "omelette", "frittata", "quiche", "souffle", "shakshuka",
    "carbonara", "challah", "french toast", "benedict",
  ],
  soy: ["soy", "soya", "soybean", "tofu", "tempeh", "edamame", "miso", "tamari", "teriyaki", "hoisin", "natto"],
  "wheat or gluten": [
    "wheat", "gluten", "flour", "bread", "breadcrumb", "pasta", "spaghetti", "macaroni", "noodle", "couscous", "semolina", "bulgur", "farro", "orzo", "panko", "tortilla",
    "barley", "rye", "seitan", "bagel", "pita", "naan", "cracker", "pretzel", "croissant", "udon", "ramen", "spelt", "kamut", "durum", "malt", "soy sauce",
    "toast", "sourdough", "baguette", "brioche", "ciabatta", "bun", "waffle", "pancake", "muffin", "biscuit", "teriyaki", "hoisin",
    "penne", "fettuccine", "linguine", "fusilli", "rigatoni", "lasagna", "lasagne", "ravioli", "tortellini", "gnocchi", "pizza", "cereal", "granola", "crouton", "dumpling",
    "wrap", "chapati", "roti", "tempura", "breaded", "batter", "graham", "freekeh", "einkorn", "emmer", "beer", "pie crust", "cake", "cookie", "brownie", "donut", "doughnut",
  ],
  fish: [
    "fish", "salmon", "tuna", "cod", "tilapia", "halibut", "trout", "sardine", "anchovy", "mackerel", "haddock", "snapper", "mahi", "swordfish", "herring", "pollock",
    "catfish", "sea bass", "fish sauce", "worcestershire", "caesar",
    "roe", "caviar", "surimi", "dashi", "bonito", "eel", "flounder", "sole", "perch", "carp", "grouper", "barramundi", "monkfish", "lox", "gravlax", "sushi", "sashimi", "poke",
    "nigiri", "bass",
  ],
  shellfish: ["shrimp", "prawn", "crab", "lobster", "mussel", "clam", "scallop", "oyster", "crawfish", "crayfish", "shellfish", "squid", "calamari", "octopus",
    "krill", "abalone", "langoustine", "cuttlefish", "conch", "whelk", "cockle", "scampi", "paella", "bisque", "cioppino", "etouffee",
  ],
  sesame: ["sesame", "tahini", "hummus", "halva", "zaatar", "za atar", "gomashio", "benne", "baba ganoush", "baba ghanoush"],
};

// "Gluten free pasta" is a pasta that names gluten only to say it has none. Each of these is stripped as a whole phrase, so the food word after it does not flag.
const GLUTEN_FREE_FOODS = [
  "bread", "pasta", "tortilla", "wrap", "noodle", "flour", "bun", "bagel", "cracker", "cereal", "pizza", "crust", "spaghetti", "penne", "macaroni", "waffle", "pancake",
  "muffin", "toast", "granola", "pita", "naan", "roll", "cookie", "brownie", "cake", "couscous", "gnocchi", "lasagna", "ravioli", "pretzel", "breadcrumb", "panko", "beer", "teriyaki",
];

// Phrases that contain an allergen word but are NOT that allergen. Removed before matching that allergen.
export const SAFE_PHRASES: Partial<Record<AllergenKey, string[]>> = {
  dairy: [
    "coconut milk", "almond milk", "oat milk", "soy milk", "rice milk", "cashew milk", "hemp milk", "pea milk", "flax milk", "coconut cream", "coconut yogurt", "coconut yoghurt",
    "coconut butter", "peanut butter", "almond butter", "cashew butter", "nut butter", "sunflower butter", "sunflower seed butter", "seed butter", "apple butter", "cocoa butter",
    "shea butter", "cream of tartar", "coconut whipped cream", "oat cream", "soy yogurt", "almond yogurt", "plant milk", "plant based milk", "dairy free",
    "butter lettuce", "butter bean", "butter squash", "cream of rice", "cream of coconut", "vegan cheese", "vegan butter", "vegan yogurt", "vegan yoghurt", "vegan cream",
    "vegan milk", "cashew cheese", "plant based cheese", "plant based butter", "plant based yogurt", "bean curd", "non dairy", "swiss chard", "romano bean", "romano pepper",
  ],
  egg: ["flax egg", "chia egg", "egg free", "egg replacer", "vegan mayo", "vegan mayonnaise", "eggless"],
  "wheat or gluten": [
    "almond flour", "coconut flour", "rice flour", "chickpea flour", "corn flour", "tapioca flour", "cassava flour", "buckwheat flour", "potato flour", "oat flour", "banana flour",
    "rice noodle", "rice noodles", "rice pasta", "corn tortilla", "corn tortillas", "rice cracker", "rice crackers", "glass noodle", "glass noodles", "soba",
    "lettuce wrap", "collard wrap", "nori wrap", "rice cake", "root beer", "ginger beer",
    ...GLUTEN_FREE_FOODS.map((w) => `gluten free ${w}`),
    ...GLUTEN_FREE_FOODS.map((w) => `wheat free ${w}`),
    "gluten free", "wheat free",
  ],
  "tree nut": ["peanut butter", "butternut", "nutmeg", "water chestnut", "water chestnuts", "nut free"],
  peanut: ["peanut free", "nut free", "pine nut", "brazil nut", "tree nut"],
  shellfish: ["oyster mushroom", "crab apple", "lobster mushroom"],
  fish: ["fish free", "fishless"],
  soy: [],
};

// Meat and poultry words, for the diet rules (a vegetarian, vegan or pescatarian is never offered these).
const MEAT_TERMS = [
  "beef", "steak", "pork", "bacon", "ham", "sausage", "chicken", "turkey", "lamb", "veal", "duck", "venison", "bison", "prosciutto", "salami", "pepperoni", "jerky",
  "meatball", "brisket", "ribs", "hot dog", "meat", "gelatin", "lard", "tallow", "goose", "rabbit", "mutton", "chorizo", "pancetta", "bone broth", "pate", "foie gras",
];
const NOT_MEAT_MARKERS = ["plant based", "vegan", "meatless", "meat free", "vegetarian", "meat alternative", "veggie"];
// A marker only clears the ONE word it sits on ("plant based chicken", "vegan sausage"), never the whole line: "chicken breast with vegan pesto" is still chicken.
const NOT_MEAT_RE = new RegExp(`(?<![a-z0-9])(?:${NOT_MEAT_MARKERS.join("|")})(?: [a-z0-9]+)?(?![a-z0-9])`, "g");

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

// EVERY word in the text that names this allergen group (textHasAllergen returns only the first), for checks that compare what a text names with what a recipe lists.
export function allergenWordsIn(text: string, key: AllergenKey): string[] {
  const normalized = stripPhrases(normalizeText(text), SAFE_PHRASES[key] ?? []);
  const found: string[] = [];
  for (const term of ALLERGEN_TERMS[key]) {
    const m = termRegex(term).exec(normalized);
    if (m) found.push(m[0].trim());
  }
  return [...new Set(found)];
}

// FOOD GROUPS people type or save as a dislike ("no pork", "no beef", "no seafood", "no meat"): the group's own words, so bacon, ham and sausage count for "no pork" and steak,
// brisket and jerky for "no beef". A line that names a group word inside a meat-free or other-animal phrase ("turkey sausage", "veggie burger", "tuna steak") is not that group.
const SEAFOOD_TERMS = [...ALLERGEN_TERMS.fish, ...ALLERGEN_TERMS.shellfish];
const PORK_TERMS = ["pork", "bacon", "ham", "sausage", "pepperoni", "prosciutto", "pancetta", "chorizo", "salami", "hot dog", "lard"];
const BEEF_TERMS = [
  "beef", "steak", "sirloin", "ribeye", "ny strip", "strip steak", "brisket", "jerky", "burger", "meatball", "chuck roast", "ground chuck", "flank", "porterhouse", "t bone",
  "short rib", "veal", "tallow",
];
const POULTRY_TERMS = ["chicken", "turkey", "duck", "goose", "poultry", "drumstick", "wings"];
const LAMB_TERMS = ["lamb", "mutton"];
// Phrases that contain a red-meat word but are another food ("turkey sausage", "veggie burger", "tuna steak"): not beef or pork. Poultry and "meat" groups do NOT use these
// (turkey sausage is still meat).
const RED_MEAT_SAFE = [
  "turkey sausage", "chicken sausage", "turkey bacon", "chicken bacon", "turkey ham", "turkey pepperoni", "turkey burger", "chicken burger", "veggie burger", "bean burger",
  "black bean burger", "salmon burger", "tuna burger", "tuna steak", "salmon steak", "fish steak", "swordfish steak", "tofu steak", "cauliflower steak", "portobello steak",
  "turkey meatball", "chicken meatball", "turkey hot dog", "chicken hot dog", "coconut bacon", "tempeh bacon",
];
const FISH_SAFE = [...(SAFE_PHRASES.fish ?? []), ...(SAFE_PHRASES.shellfish ?? [])];
// Every meat word: the general meat list plus all the cuts of the groups above (so a ribeye or a burger is meat too).
const ALL_MEAT_TERMS = [...new Set([...MEAT_TERMS, ...BEEF_TERMS, ...PORK_TERMS, ...POULTRY_TERMS, ...LAMB_TERMS, "venison", "bison"])];
const FOOD_GROUPS: Record<string, { terms: string[]; safe: string[] }> = {
  pork: { terms: PORK_TERMS, safe: RED_MEAT_SAFE },
  beef: { terms: BEEF_TERMS, safe: RED_MEAT_SAFE },
  chicken: { terms: ["chicken", "drumstick", "wings", "poultry"], safe: [] },
  poultry: { terms: POULTRY_TERMS, safe: [] },
  turkey: { terms: ["turkey"], safe: [] },
  lamb: { terms: LAMB_TERMS, safe: [] },
  "red meat": { terms: [...BEEF_TERMS, ...PORK_TERMS, ...LAMB_TERMS, "venison", "bison"], safe: RED_MEAT_SAFE },
  seafood: { terms: SEAFOOD_TERMS, safe: FISH_SAFE },
  meat: { terms: ALL_MEAT_TERMS, safe: [] },
  "animal products": {
    terms: [...ALL_MEAT_TERMS, ...SEAFOOD_TERMS, ...ALLERGEN_TERMS.dairy, ...ALLERGEN_TERMS.egg, "honey"],
    safe: [...FISH_SAFE, ...(SAFE_PHRASES.dairy ?? []), ...(SAFE_PHRASES.egg ?? [])],
  },
};
type RuleEntry = { label: string; key: AllergenKey | null; terms: string[]; group?: boolean; safe?: string[] };
function groupEntry(raw: string): RuleEntry | null {
  const name = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const g = FOOD_GROUPS[name] ?? FOOD_GROUPS[name.replace(/s$/, "")];
  return g ? { label: name, key: null, terms: g.terms, group: true, safe: g.safe } : null;
}

// An allergy item as stored: one of the controlled names, or "other: kiwi" free text.
function allergyTerms(item: string): { label: string; key: AllergenKey | null; terms: string[] } | null {
  const raw = item.trim().toLowerCase();
  if (!raw) return null;
  if (raw.startsWith("other:")) {
    const word = raw.slice("other:".length).trim();
    if (!word) return null;
    const key = ALIASES[word] ?? null;
    return key ? { label: word, key, terms: ALLERGEN_TERMS[key] } : groupEntry(word) ?? { label: word, key: null, terms: [word] };
  }
  const key = (ALLERGEN_KEYS as string[]).includes(raw) ? (raw as AllergenKey) : ALIASES[raw] ?? null;
  return key ? { label: key, key, terms: ALLERGEN_TERMS[key] } : groupEntry(raw) ?? { label: raw, key: null, terms: [raw] };
}

// The controlled allergen groups a client's allergy list covers (a typed alias such as "lactose" or "other: gluten" counts; free text that is no group does not).
export function allergyKeysOf(allergies: string[] | undefined): Set<AllergenKey> {
  const keys = new Set<AllergenKey>();
  for (const item of allergies ?? []) {
    const a = allergyTerms(item);
    if (a?.key) keys.add(a.key);
  }
  return keys;
}

// An intolerance or dislike is whatever the person typed; a known word ("lactose", "gluten") also covers its group.
function looseTerms(item: string): { label: string; key: AllergenKey | null; terms: string[] } | null {
  const raw = item.trim().toLowerCase();
  if (!raw) return null;
  const key = ALIASES[raw] ?? null;
  return key ? { label: raw, key, terms: ALLERGEN_TERMS[key] } : groupEntry(raw) ?? { label: raw, key: null, terms: [raw] };
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
  // "Plant based chicken" is not meat, whatever animal it is named after; only the marked word is cleared.
  const meatText = normalized.replace(NOT_MEAT_RE, " ");
  const meat = firstMatch(meatText, MEAT_TERMS);
  if (meat) return { label: dietType, matched: meat };
  if (dietType === "vegetarian" || dietType === "vegan") {
    const fish = textHasAllergen(normalized, "fish") ?? textHasAllergen(normalized, "shellfish");
    if (fish) return { label: dietType, matched: fish };
  }
  if (dietType === "vegan") {
    const animal = textHasAllergen(normalized, "dairy") ?? textHasAllergen(normalized, "egg") ?? firstMatch(normalized, ["honey"]);
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
    const test = (entry: RuleEntry, kind: AllergenHit["kind"]) => {
      // A group word inside a meat-free or other-animal phrase ("vegan sausage", "turkey sausage") is not that group.
      const text = entry.key ? stripPhrases(base, SAFE_PHRASES[entry.key] ?? []) : entry.group ? stripPhrases(base.replace(NOT_MEAT_RE, " "), entry.safe ?? []) : base;
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
