import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFoodDetail, type FoodHit } from "@/lib/food-search";
import { runFoodSearch, type FoodSearchResult } from "@/lib/food-search-run";
import { GRAMS_PER_OUNCE, type FoodPortion, type NutrientMap } from "@/lib/food-serving";
import type { PackagedHit } from "@/lib/packaged-foods";
import { clampMealMacros } from "@/lib/ai-nutrition-clamp";
import { FOOD_DATABASE_SOURCE, FOOD_ESTIMATE_SOURCE, type QuickLogFoodSource } from "@/lib/food-estimate-source";

// The typed quick-log (Nov 23, Spotters keep up): the model only splits what the client typed into foods and amounts (with its own estimate for each, kept as the fallback).
// Each food is then looked up with the same search the client uses (lib/food-search-run.ts: the everyday USDA foods, the packaged ones, and the spelling help), and its numbers
// come from the USDA row, scaled to the amount. A food nothing matches keeps the estimate, and then the whole entry is tagged as an estimate. The client still sees the result
// and confirms it before anything is saved (meal-checkoff-list.tsx).

export interface ParsedFoodItem {
  food: string;
  quantity: number | null;
  unit: string | null;
  // the model's own idea of the amount in grams (used when the unit is not one USDA lists for the food)
  grams: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface MatchedFoodItem {
  text: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  matched: boolean;
}

export const MAX_ITEMS = 12;
const MAX_ITEM_GRAMS = 3000;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const nonNeg = (v: unknown): number => Math.max(0, num(v) ?? 0);

// The model's answer, checked (pure, tested): at most 12 foods, each with a name, a believable amount and numbers. Null when nothing usable came back.
export function parseItems(raw: unknown): ParsedFoodItem[] | null {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? ((raw as { items: unknown[] }).items) : null;
  if (!list) return null;
  const items: ParsedFoodItem[] = [];
  for (const r of list.slice(0, MAX_ITEMS)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const food = str(o.food, 120);
    if (!food) continue;
    const quantity = num(o.quantity);
    const grams = Math.min(MAX_ITEM_GRAMS, Math.max(1, num(o.grams) ?? 100));
    items.push({
      food,
      quantity: quantity != null && quantity > 0 && quantity <= 1000 ? quantity : null,
      unit: str(o.unit, 40),
      grams,
      calories: nonNeg(o.calories),
      proteinG: nonNeg(o.proteinG),
      carbsG: nonNeg(o.carbsG),
      fatG: nonNeg(o.fatG),
    });
  }
  return items.length > 0 ? items : null;
}

const singular = (w: string): string =>
  w.length > 3 && /(ch|sh|x|o)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

// The short forms people type for the measures USDA spells out.
const UNIT_WORDS: Record<string, string> = { tbsp: "tablespoon", tbs: "tablespoon", tbl: "tablespoon", tsp: "teaspoon", c: "cup", pc: "piece", pcs: "piece", sl: "slice" };
const GRAMS_PER_POUND = 453.592;

// How many grams the item is (pure, tested): grams and ounces as typed; a household measure USDA lists for the food ("1 cup", "1 large", "1 slice") by its weight; otherwise the
// model's own grams.
export function gramsForItem(item: Pick<ParsedFoodItem, "quantity" | "unit" | "grams">, portions: FoodPortion[]): number {
  const qty = item.quantity ?? 1;
  const unit = (item.unit ?? "").toLowerCase().replace(/[^a-z ]/g, "").trim();
  const clamp = (g: number) => Math.min(MAX_ITEM_GRAMS, Math.max(1, Math.round(g * 10) / 10));
  if (/^(g|gram|grams|gr|ml|milliliter|milliliters|millilitre|millilitres)$/.test(unit)) return clamp(qty);
  if (/^(oz|ounce|ounces)$/.test(unit)) return clamp(qty * GRAMS_PER_OUNCE);
  if (/^(lb|lbs|pound|pounds)$/.test(unit)) return clamp(qty * GRAMS_PER_POUND);
  if (unit) {
    const last = unit.split(" ").pop() ?? unit;
    const word = UNIT_WORDS[last] ?? singular(last);
    const portion = [...portions]
      .sort((a, b) => a.seq - b.seq)
      .find((p) => p.gramWeight > 0 && new RegExp(`\\b${word}(e?s)?\\b`, "i").test(p.description));
    if (portion) return clamp(portion.gramWeight * qty);
  }
  return clamp(item.grams);
}

const whole = (n: number | undefined): number => Math.round(Number.isFinite(n) ? (n as number) : 0);

// The macros of `grams` of a food stored per 100 g (pure). Null when the food has no calories on file.
export function macrosForGrams(per100g: NutrientMap, grams: number): Omit<MatchedFoodItem, "text" | "matched"> | null {
  if (typeof per100g.kcal !== "number") return null;
  const f = grams / 100;
  return { calories: whole(per100g.kcal * f), proteinG: whole((per100g.protein_g ?? 0) * f), carbsG: whole((per100g.carbs_g ?? 0) * f), fatG: whole((per100g.fat_g ?? 0) * f) };
}

// "2 large egg", "1 cup whole milk": the client's own wording of the item.
export function itemText(item: Pick<ParsedFoodItem, "food" | "quantity" | "unit">): string {
  const q = item.quantity != null ? `${Math.round(item.quantity * 100) / 100}` : "";
  return [q, item.unit ?? "", item.food].filter((p) => p !== "").join(" ");
}

type Search = (supabase: SupabaseClient, query: string) => Promise<FoodSearchResult>;
type Detail = (supabase: SupabaseClient, fdcId: number) => Promise<{ per100g: NutrientMap; portions: FoodPortion[] } | null>;

function packagedPortions(hit: PackagedHit): FoodPortion[] {
  return hit.servingSize != null && hit.servingSize > 0 && (hit.servingSizeUnit === "g" || hit.servingSizeUnit === "ml")
    ? [{ seq: 1, description: hit.householdServing ? `${hit.householdServing} serving` : "1 serving", gramWeight: hit.servingSize }]
    : [];
}

// One item: the first everyday USDA food the search finds, else the first packaged one; its numbers scaled to the amount. The estimate when nothing is found or a read fails.
export async function matchFoodItem(supabase: SupabaseClient, item: ParsedFoodItem, search: Search = runFoodSearch, detail: Detail = loadFoodDetail): Promise<MatchedFoodItem> {
  const text = itemText(item);
  const estimate: MatchedFoodItem = { text, calories: whole(item.calories), proteinG: whole(item.proteinG), carbsG: whole(item.carbsG), fatG: whole(item.fatG), matched: false };
  try {
    const found = await search(supabase, item.food);
    const everyday: FoodHit | undefined = (found.hits ?? []).find((h) => typeof h.per100g.kcal === "number");
    if (everyday) {
      const d = await detail(supabase, everyday.fdcId);
      const per100g = d && typeof d.per100g.kcal === "number" ? d.per100g : everyday.per100g;
      const m = macrosForGrams(per100g, gramsForItem(item, d?.portions ?? []));
      if (m) return { text, ...m, matched: true };
    }
    const packaged = found.packaged.find((h) => typeof h.per100g.kcal === "number");
    if (packaged) {
      const m = macrosForGrams(packaged.per100g, gramsForItem(item, packagedPortions(packaged)));
      if (m) return { text, ...m, matched: true };
    }
  } catch {
    // the estimate stands
  }
  return estimate;
}

// The one entry the client confirms (pure, tested): the foods listed, the totals (within the believable limits of one meal), USDA when every food was found, else an estimate.
export function combineItems(items: MatchedFoodItem[]): { description: string; calories: number; proteinG: number; carbsG: number; fatG: number; foodSource: QuickLogFoodSource } {
  const total = items.reduce((t, i) => ({ calories: t.calories + i.calories, proteinG: t.proteinG + i.proteinG, carbsG: t.carbsG + i.carbsG, fatG: t.fatG + i.fatG }), { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  return {
    description: items.map((i) => i.text).join(", ").slice(0, 500),
    ...clampMealMacros(total),
    foodSource: items.length > 0 && items.every((i) => i.matched) ? FOOD_DATABASE_SOURCE : FOOD_ESTIMATE_SOURCE,
  };
}
