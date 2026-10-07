import { ALLERGEN_KEYS } from "@/lib/allergen-check";

// One client's food preferences and the protein rules the coach sets for them. The database row is client_nutrition_preferences (one per CLIENT, not per group); this
// file is everything about it that needs no database: the shape, the defaults, validation, and how protein is judged.

export const DIET_TYPES = ["omnivore", "vegetarian", "vegan", "pescatarian", "carnivore", "keto", "paleo"] as const;
export type DietTypeValue = (typeof DIET_TYPES)[number];
export const VARIETIES = ["mix_it_up", "few_favorites", "same_most_days"] as const;
export type VarietyValue = (typeof VARIETIES)[number];
export const CARB_SPLITS = ["high", "balanced", "low"] as const;
export type CarbSplitValue = (typeof CARB_SPLITS)[number];

export const DIET_LABELS: Record<DietTypeValue, string> = {
  omnivore: "Eats everything",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  pescatarian: "Pescatarian (fish, no meat)",
  carnivore: "Carnivore",
  keto: "Keto",
  paleo: "Paleo",
};
export const VARIETY_LABELS: Record<VarietyValue, string> = {
  mix_it_up: "Mix it up",
  few_favorites: "A few favorites on repeat",
  same_most_days: "Same meals most days",
};
export const CARB_SPLIT_LABELS: Record<CarbSplitValue, string> = { high: "Higher carb", balanced: "Balanced", low: "Lower carb" };
export const ALLERGY_LABELS: Record<string, string> = {
  peanut: "Peanut",
  "tree nut": "Tree nuts",
  dairy: "Dairy",
  egg: "Egg",
  soy: "Soy",
  "wheat or gluten": "Wheat or gluten",
  fish: "Fish",
  shellfish: "Shellfish",
  sesame: "Sesame",
};

export const MAX_LIST_ITEMS = 40;
export const MAX_ALLERGY_ITEMS = 20;
export const MAX_ITEM_LENGTH = 60;
export const MAX_NOTES_LENGTH = 500;
export const PROTEIN_TARGET_RANGE = { min: 0.6, max: 1.5 } as const;
export const PROTEIN_FLOOR_RANGE = { min: 0.4, max: 1.5 } as const;
export const DEFAULT_PROTEIN_TARGET = 1.0;
export const DEFAULT_PROTEIN_FLOOR = 0.8;

export interface NutritionPreferences {
  likes: string[];
  dislikes: string[];
  allergies: string[];
  intolerances: string[];
  dietType: DietTypeValue;
  mealsPerDay: number;
  includeSnack: boolean;
  variety: VarietyValue;
  proteinGPerLb: number;
  proteinFloorGPerLb: number;
  carbSplit: CarbSplitValue;
  notes: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const DEFAULT_PREFERENCES: NutritionPreferences = {
  likes: [],
  dislikes: [],
  allergies: [],
  intolerances: [],
  dietType: "omnivore",
  mealsPerDay: 3,
  includeSnack: false,
  variety: "few_favorites",
  proteinGPerLb: DEFAULT_PROTEIN_TARGET,
  proteinFloorGPerLb: DEFAULT_PROTEIN_FLOOR,
  carbSplit: "balanced",
  notes: "",
  updatedBy: null,
  updatedAt: null,
};

export interface PreferencesRow {
  likes?: string[] | null;
  dislikes?: string[] | null;
  allergies?: string[] | null;
  intolerances?: string[] | null;
  diet_type?: string | null;
  meals_per_day?: number | null;
  include_snack?: boolean | null;
  variety?: string | null;
  protein_g_per_lb?: number | string | null;
  protein_floor_g_per_lb?: number | string | null;
  carb_split?: string | null;
  notes?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
}

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const num = (v: unknown, fallback: number) => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
};

// What the database holds (or nothing at all) as the preferences the app works with. A missing row is the defaults; a bad value falls back to its default.
export function rowToPreferences(row: PreferencesRow | null | undefined): NutritionPreferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  const target = num(row.protein_g_per_lb, DEFAULT_PROTEIN_TARGET);
  const floor = num(row.protein_floor_g_per_lb, DEFAULT_PROTEIN_FLOOR);
  return {
    likes: [...(row.likes ?? [])],
    dislikes: [...(row.dislikes ?? [])],
    allergies: [...(row.allergies ?? [])],
    intolerances: [...(row.intolerances ?? [])],
    dietType: pick(DIET_TYPES, row.diet_type, "omnivore"),
    mealsPerDay: Math.min(6, Math.max(2, Math.round(num(row.meals_per_day, 3)))),
    includeSnack: !!row.include_snack,
    variety: pick(VARIETIES, row.variety, "few_favorites"),
    proteinGPerLb: target,
    proteinFloorGPerLb: Math.min(floor, target),
    carbSplit: pick(CARB_SPLITS, row.carb_split, "balanced"),
    notes: row.notes ?? "",
    updatedBy: row.updated_by ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

// The columns to write for a save. `onlyTastes` is what a CLIENT saves: the rules that shape the numbers (diet type, protein, split) are the coach's, and the database
// keeps a client's change to them from sticking anyway, so they are not even sent.
export function preferencesToRow(p: NutritionPreferences, athleteId: string, opts: { onlyTastes?: boolean } = {}) {
  const tastes = {
    athlete_id: athleteId,
    likes: p.likes,
    dislikes: p.dislikes,
    allergies: p.allergies,
    intolerances: p.intolerances,
    meals_per_day: p.mealsPerDay,
    include_snack: p.includeSnack,
    variety: p.variety,
    notes: p.notes,
  };
  if (opts.onlyTastes) return tastes;
  return {
    ...tastes,
    diet_type: p.dietType,
    protein_g_per_lb: p.proteinGPerLb,
    protein_floor_g_per_lb: p.proteinFloorGPerLb,
    carb_split: p.carbSplit,
  };
}

// One typed chip: trimmed, spaces collapsed, at most 60 characters. Empty is refused.
export function cleanItem(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_LENGTH).trim();
}

export function addItem(list: string[], text: string, max = MAX_LIST_ITEMS): { list: string[]; error: string | null } {
  const item = cleanItem(text);
  if (!item) return { list, error: null };
  if (list.some((x) => x.toLowerCase() === item.toLowerCase())) return { list, error: null };
  if (list.length >= max) return { list, error: `That list is full (${max} at most).` };
  return { list: [...list, item], error: null };
}

export function removeItem(list: string[], item: string): string[] {
  return list.filter((x) => x !== item);
}

// An allergy is stored as one of the controlled names, or "other: free text" (lower-case, like the database check expects).
export function toggleAllergy(allergies: string[], name: string): string[] {
  const key = name.toLowerCase();
  return allergies.some((a) => a.toLowerCase() === key) ? allergies.filter((a) => a.toLowerCase() !== key) : [...allergies, key];
}

export function addOtherAllergy(allergies: string[], text: string): { list: string[]; error: string | null } {
  const item = cleanItem(text.replace(/^other:\s*/i, ""));
  if (!item) return { list: allergies, error: null };
  const stored = `other: ${item}`.toLowerCase().slice(0, MAX_ITEM_LENGTH);
  if (allergies.some((a) => a.toLowerCase() === stored)) return { list: allergies, error: null };
  if (allergies.length >= MAX_ALLERGY_ITEMS) return { list: allergies, error: `That list is full (${MAX_ALLERGY_ITEMS} at most).` };
  return { list: [...allergies, stored], error: null };
}

export function allergyLabel(a: string): string {
  const key = a.toLowerCase();
  if (key.startsWith("other: ")) return a.slice("other: ".length);
  return ALLERGY_LABELS[key] ?? a;
}

export const isControlledAllergy = (a: string) => (ALLERGEN_KEYS as string[]).includes(a.toLowerCase());

export function validateProteinSettings(target: number, floor: number): string | null {
  if (!Number.isFinite(target) || target < PROTEIN_TARGET_RANGE.min || target > PROTEIN_TARGET_RANGE.max) {
    return `The protein target is between ${PROTEIN_TARGET_RANGE.min} and ${PROTEIN_TARGET_RANGE.max} g per pound.`;
  }
  if (!Number.isFinite(floor) || floor < PROTEIN_FLOOR_RANGE.min || floor > PROTEIN_FLOOR_RANGE.max) {
    return `The protein floor is between ${PROTEIN_FLOOR_RANGE.min} and ${PROTEIN_FLOOR_RANGE.max} g per pound.`;
  }
  if (floor > target) return "The protein floor can't be above the target.";
  return null;
}

// Whole grams for this client's weight. The TARGET is a stretch to aim for; the FLOOR is the line below which a day is a shortfall.
export function proteinGramsForWeight(prefs: Pick<NutritionPreferences, "proteinGPerLb" | "proteinFloorGPerLb">, weightLbs: number): { targetG: number; floorG: number } {
  return { targetG: Math.round(weightLbs * prefs.proteinGPerLb), floorG: Math.round(weightLbs * prefs.proteinFloorGPerLb) };
}

// How a day's logged protein reads. At or above the target is a hit. Between the floor and the target is a solid day ("fell short successfully": nothing to warn about).
// Only below the floor is a shortfall. Falling short is information, not failure.
export type ProteinDay = "hit" | "solid" | "shortfall";
export function judgeProteinDay(grams: number, targetG: number, floorG: number): ProteinDay {
  if (grams >= targetG) return "hit";
  if (grams >= floorG) return "solid";
  return "shortfall";
}

// Has this client said anything that limits what they are offered?
export function hasFoodRules(p: Pick<NutritionPreferences, "allergies" | "intolerances" | "dislikes" | "dietType">): boolean {
  return p.allergies.length > 0 || p.intolerances.length > 0 || p.dislikes.length > 0 || (p.dietType !== "omnivore" && p.dietType !== "carnivore" && p.dietType !== "keto" && p.dietType !== "paleo");
}

// The same preferences as the plain restrictions line the meal generator and the weekly check-in already take ("vegetarian, no peanut, no mushrooms"), so the coach is not
// asked to type again what the client already told them. Empty when there is nothing to say.
export function restrictionsTextFromPreferences(p: Pick<NutritionPreferences, "allergies" | "intolerances" | "dislikes" | "dietType">): string {
  const parts: string[] = [];
  if (p.dietType !== "omnivore") parts.push(p.dietType);
  for (const a of p.allergies) parts.push(`no ${allergyLabel(a).toLowerCase()}`);
  for (const i of p.intolerances) parts.push(`no ${i.toLowerCase()}`);
  for (const d of p.dislikes) parts.push(`no ${d.toLowerCase()}`);
  return parts.join(", ");
}
