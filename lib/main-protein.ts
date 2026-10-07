// The food that supplies most of a meal's protein, as a short family name ("chicken", "beef", "salmon"), so a day's three options can use different ones. A family is
// read from the food's name; a name that matches nothing here is its own family (its first word), never an error.

const FAMILIES: [string, string[]][] = [
  ["chicken", ["chicken"]],
  ["turkey", ["turkey"]],
  ["beef", ["beef", "steak", "sirloin", "ribeye", "strip", "flank", "chuck", "brisket", "porterhouse", "jerky", "bison", "veal", "lamb"]],
  ["pork", ["pork", "bacon", "ham ", "ham,", "sausage"]],
  ["salmon", ["salmon"]],
  ["fish", ["tuna", "cod", "halibut", "tilapia", "trout", "mahi", "sardine", "mackerel", "fish", "haddock", "snapper", "bass"]],
  ["shellfish", ["shrimp", "scallop", "crab", "lobster", "prawn"]],
  ["egg", ["egg"]],
  ["dairy", ["greek yogurt", "yogurt", "cottage cheese", "cheese", "whey", "casein", "milk", "skyr"]],
  ["tofu", ["tofu", "tempeh", "edamame"]],
  ["plant", ["seitan", "tvp", "pea protein", "plant protein", "lentil", "bean", "chickpea"]],
];

const clean = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9, ]+/g, " ").replace(/\s+/g, " ").trim();

export function proteinFamily(name: string): string {
  const text = ` ${clean(name)} `;
  for (const [family, words] of FAMILIES) {
    if (words.some((w) => text.includes(w))) return family;
  }
  const first = clean(name).split(" ")[0];
  return first || "other";
}

// The family of the line that carries the most protein. Lines are { name, proteinG }; nothing with protein gives null.
export function mainProteinOf(lines: { name: string; proteinG: number }[]): string | null {
  let best: { name: string; proteinG: number } | null = null;
  for (const l of lines) if (l.proteinG > 0 && (!best || l.proteinG > best.proteinG)) best = l;
  return best ? proteinFamily(best.name) : null;
}
