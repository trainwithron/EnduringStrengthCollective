// Data-orchestration layer for the Nutrition Spot's accuracy check
// (nutrition_spot_revamp_scoping_sept19.md) — real Supabase queries, no
// unit tests of its own (same convention as lib/equipment-load-ratio-
// gather.ts: only the pure functions it calls, lib/food-matching.ts,
// are tested directly). Runs every AI-generated meal option's ingredient
// lines back against real USDA food data before an option is ever
// surfaced as pickable — the whole point of this revamp is that the AI
// never gets to be the last word on a claimed macro number.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseIngredientLine,
  pickBestFoodMatch,
  pickSearchTerm,
  type FoodCandidate,
} from "./food-matching";

export interface RawMealOption {
  recipeName: string;
  ingredients: string[];
}

export interface VerifiedIngredientLine {
  rawLine: string;
  name: string | null;
  grams: number | null;
  matchedFdcId: number | null;
  matchedDescription: string | null;
  matchScore: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  kcal: number | null;
}

export interface VerifiedMealOption {
  recipeName: string;
  ingredients: VerifiedIngredientLine[];
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  totalKcal: number;
  // True only when every ingredient line parsed AND matched a real food
  // above the confidence bar — the actual gate on whether this option
  // is ever shown as pickable (never a partial-trust in-between state).
  confident: boolean;
}

const MACRO_NUTRIENT_KEYS = ["protein_g", "carbs_g", "fat_g", "kcal"] as const;

async function verifyIngredientLine(
  supabase: SupabaseClient,
  rawLine: string,
  nutrientCache: Map<number, Map<string, number>>
): Promise<VerifiedIngredientLine> {
  const parsed = parseIngredientLine(rawLine);
  if (!parsed) {
    return {
      rawLine,
      name: null,
      grams: null,
      matchedFdcId: null,
      matchedDescription: null,
      matchScore: 0,
      protein: null,
      carbs: null,
      fat: null,
      kcal: null,
    };
  }

  const searchTerm = pickSearchTerm(parsed.name);
  const { data: candidateRows } = searchTerm
    ? await supabase.from("usda_foods").select("fdc_id, description").ilike("description", `%${searchTerm}%`).limit(25)
    : { data: [] };
  const candidates: FoodCandidate[] = (candidateRows ?? []).map((r) => ({ fdcId: r.fdc_id as number, description: r.description as string }));
  const match = pickBestFoodMatch(parsed.name, candidates);

  if (!match) {
    return {
      rawLine,
      name: parsed.name,
      grams: parsed.grams,
      matchedFdcId: null,
      matchedDescription: null,
      matchScore: 0,
      protein: null,
      carbs: null,
      fat: null,
      kcal: null,
    };
  }

  let nutrientsByKey = nutrientCache.get(match.fdcId);
  if (!nutrientsByKey) {
    const { data: nutrientRows } = await supabase
      .from("usda_food_nutrients")
      .select("nutrient_key, amount_per_100g")
      .eq("fdc_id", match.fdcId)
      .in("nutrient_key", MACRO_NUTRIENT_KEYS);
    nutrientsByKey = new Map((nutrientRows ?? []).map((r) => [r.nutrient_key as string, r.amount_per_100g as number]));
    nutrientCache.set(match.fdcId, nutrientsByKey);
  }

  const scale = parsed.grams / 100;
  const scaled = (key: string) => (nutrientsByKey!.has(key) ? nutrientsByKey!.get(key)! * scale : null);

  return {
    rawLine,
    name: parsed.name,
    grams: parsed.grams,
    matchedFdcId: match.fdcId,
    matchedDescription: match.description,
    matchScore: match.score,
    protein: scaled("protein_g"),
    carbs: scaled("carbs_g"),
    fat: scaled("fat_g"),
    kcal: scaled("kcal"),
  };
}

export async function verifyMealOption(supabase: SupabaseClient, option: RawMealOption): Promise<VerifiedMealOption> {
  // Cached per-call (not module-level) — a single fdc_id's nutrient row
  // is genuinely likely to repeat across ingredient lines within one
  // meal option (e.g. two lines both resolving to "chicken breast").
  const nutrientCache = new Map<number, Map<string, number>>();
  const ingredients = await Promise.all(option.ingredients.map((line) => verifyIngredientLine(supabase, line, nutrientCache)));

  const confident = ingredients.length > 0 && ingredients.every((i) => i.matchedFdcId != null);
  const sum = (key: "protein" | "carbs" | "fat" | "kcal") =>
    ingredients.reduce((total, i) => total + (i[key] ?? 0), 0);

  return {
    recipeName: option.recipeName,
    ingredients,
    totalProtein: Math.round(sum("protein")),
    totalCarbs: Math.round(sum("carbs")),
    totalFat: Math.round(sum("fat")),
    totalKcal: Math.round(sum("kcal")),
    confident,
  };
}

// Verifies every candidate option and returns only the confident ones —
// "flag or discard low-confidence ones rather than showing an
// unverified number" (the scoping's own words). Options run in
// parallel; a request generating 3 options doesn't need to serialize
// their (independent) verification passes.
export async function verifyMealOptions(supabase: SupabaseClient, options: RawMealOption[]): Promise<VerifiedMealOption[]> {
  const verified = await Promise.all(options.map((o) => verifyMealOption(supabase, o)));
  return verified.filter((o) => o.confident);
}
