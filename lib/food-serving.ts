// Servings and nutrient arithmetic for the food search (pure). A food's numbers are stored per 100 g; a client logs an amount in grams, ounces or a household measure USDA
// publishes for that food ("1 cup, chopped" = 140 g), and every nutrient is scaled from the per-100 g value. A nutrient a food does not report is simply absent from the
// map ("not reported"), never zero.

export const GRAMS_PER_OUNCE = 28.3495;
export const MAX_SERVING_QTY = 10000;
export const MAX_AMOUNT_G = 20000;

export const gramsToOunces = (g: number): number => g / GRAMS_PER_OUNCE;
export const ouncesToGrams = (oz: number): number => oz * GRAMS_PER_OUNCE;

const trim1 = (n: number): string => (Math.round(n * 10) / 10).toString();

// Both units, always: "158 g (5.6 oz)".
export function formatAmount(grams: number): string {
  return `${trim1(grams)} g (${trim1(gramsToOunces(grams))} oz)`;
}

export type NutrientMap = Record<string, number>;

export interface ServingOption {
  key: string;
  // What the person sees: "1 cup, chopped", "grams", "ounces".
  label: string;
  // Grams in ONE of this serving.
  gramWeight: number;
  kind: "portion" | "grams" | "ounces";
}

export interface FoodPortion {
  seq: number;
  description: string;
  gramWeight: number;
}

// The household measures first (in the order USDA lists them), then grams and ounces, which every food has.
export function servingOptions(portions: FoodPortion[] = []): ServingOption[] {
  const household = [...portions]
    .filter((p) => p.gramWeight > 0 && p.description.trim() !== "")
    .sort((a, b) => a.seq - b.seq)
    .map<ServingOption>((p) => ({ key: `p${p.seq}`, label: p.description.trim(), gramWeight: p.gramWeight, kind: "portion" }));
  return [
    ...household,
    { key: "g", label: "grams", gramWeight: 1, kind: "grams" },
    { key: "oz", label: "ounces", gramWeight: GRAMS_PER_OUNCE, kind: "ounces" },
  ];
}

// What the picker starts on: the first household measure at 1, else 100 grams.
export function defaultServing(options: ServingOption[]): { option: ServingOption; qty: number } {
  const first = options.find((o) => o.kind === "portion");
  if (first) return { option: first, qty: 1 };
  const grams = options.find((o) => o.kind === "grams") ?? options[0];
  return { option: grams, qty: 100 };
}

// Grams for a quantity of a serving, to a tenth of a gram. Null when the quantity is not a sane positive number.
export function gramsFor(option: ServingOption, qty: number): number | null {
  if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_SERVING_QTY) return null;
  const g = Math.round(option.gramWeight * qty * 10) / 10;
  return g > 0 && g <= MAX_AMOUNT_G ? g : null;
}

export function quantityProblem(option: ServingOption, qty: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return "Enter an amount greater than zero.";
  if (qty > MAX_SERVING_QTY) return "That amount is too large.";
  if (gramsFor(option, qty) == null) return "That comes to more than 20 kg; check the amount.";
  return null;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

// Every nutrient the food reports, for this many grams.
export function scaleNutrients(per100g: NutrientMap, grams: number): NutrientMap {
  const out: NutrientMap = {};
  for (const [key, amount] of Object.entries(per100g)) {
    if (typeof amount === "number" && Number.isFinite(amount)) out[key] = round3((amount * grams) / 100);
  }
  return out;
}

// The per-100 g values back from a stored snapshot (so an entry can be re-scaled without asking USDA again).
export function per100gFromSnapshot(nutrients: NutrientMap, amountG: number): NutrientMap {
  return scaleNutrients(nutrients, 10000 / amountG);
}

export interface Macros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  // True when the food reports no energy value and the calories were worked out from its protein, carbs and fat (4/4/9).
  caloriesComputed: boolean;
}

// The four numbers a food log entry stores. Energy comes from the food's own value; a food with none gets 4/4/9 from its macros and is marked as computed.
export function macrosOf(n: NutrientMap): Macros {
  const proteinG = Math.round((n.protein_g ?? 0) * 10) / 10;
  const carbsG = Math.round((n.carbs_g ?? 0) * 10) / 10;
  const fatG = Math.round((n.fat_g ?? 0) * 10) / 10;
  const reported = typeof n.kcal === "number";
  return {
    calories: Math.round(reported ? n.kcal : 4 * proteinG + 4 * carbsG + 9 * fatG),
    proteinG,
    carbsG,
    fatG,
    caloriesComputed: !reported,
  };
}

// A short line for a logged serving: "1.5 x 1 cup, chopped" or "85 g (3 oz)".
export function servingText(args: { servingLabel: string | null; servingQty: number | null; amountG: number | null }): string {
  const { servingLabel, servingQty, amountG } = args;
  if (amountG == null) return "";
  if (servingLabel && servingQty != null && servingLabel !== "grams" && servingLabel !== "ounces") {
    return `${trim1(servingQty)} x ${servingLabel} (${formatAmount(amountG)})`;
  }
  return formatAmount(amountG);
}
