import type { SupabaseClient } from "@supabase/supabase-js";
import type { FoodPortion, NutrientMap } from "@/lib/food-serving";

// Searching the USDA foods already stored in the database (about 8,200 Foundation and SR Legacy foods). No AI, no outside service, no cost: this is the free default way to log
// food. A query is split into words; a food matches when its name contains every word; matches are ranked so the food the person means comes first (USDA names put the food
// first: "Chicken, broilers or fryers, breast, meat only, cooked, roasted").

export const SEARCH_RESULT_LIMIT = 25;
const CANDIDATE_LIMIT = 300;
const MAX_TOKENS = 6;
export const HIT_MACRO_KEYS = ["kcal", "protein_g", "carbs_g", "fat_g"] as const;

export interface FoodRow {
  fdc_id: number;
  description: string;
  data_type?: string | null;
  food_category?: string | null;
}

export interface FoodHit {
  fdcId: number;
  description: string;
  category: string | null;
  dataType: string | null;
  // Per 100 g; a key is absent when the food does not report it.
  per100g: NutrientMap;
}

// The words of a query: lower case, letters and digits only, single letters dropped (except digits), no repeats, at most six.
export function tokenize(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 || /\d/.test(w));
  return [...new Set(words)].slice(0, MAX_TOKENS);
}

// Escapes the characters that mean something in a LIKE pattern.
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const segmentsOf = (description: string): string[] => description.toLowerCase().split(",").map((s) => s.trim());

// Higher is better. A word in the food's first name segment ("Chicken") counts most, in the second less, anywhere else least; the name starting with the first word, or equal to the
// whole query, and a short name, all add a little. Foundation foods (the most carefully measured) win ties.
export function scoreFood(row: FoodRow, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const desc = row.description.toLowerCase();
  const segs = segmentsOf(row.description);
  let score = 0;
  for (const t of tokens) {
    const wordInSeg = (seg: string) => new RegExp(`(^|[^a-z0-9])${t}`).test(seg);
    if (segs[0] && wordInSeg(segs[0])) score += 6;
    else if (segs[1] && wordInSeg(segs[1])) score += 3;
    else if (wordInSeg(desc)) score += 1.5;
    else score += 0.5;
  }
  if (desc.startsWith(tokens[0])) score += 4;
  if (segs[0] === tokens.join(" ")) score += 6;
  score -= desc.length * 0.02;
  if (row.data_type === "Foundation") score += 0.5;
  return score;
}

export function rankFoodRows(rows: FoodRow[], query: string, limit = SEARCH_RESULT_LIMIT): FoodRow[] {
  const tokens = tokenize(query);
  return [...rows]
    .map((row) => ({ row, score: scoreFood(row, tokens) }))
    .sort((a, b) => b.score - a.score || a.row.description.length - b.row.description.length || a.row.fdc_id - b.row.fdc_id)
    .slice(0, limit)
    .map((x) => x.row);
}

// Runs in the browser with the signed-in person's client: the USDA tables are readable by any signed-in person.
interface SearchRpcRow {
  fdc_id: number;
  description: string;
  data_type: string | null;
  food_category: string | null;
  kcal: number | string | null;
  protein_g: number | string | null;
  carbs_g: number | string | null;
  fat_g: number | string | null;
}

// The ranking happens in the database (search_usda_foods, migration 0300): a common word matches hundreds of foods, so the best must be chosen there, not from whatever rows come
// back first. Returns null when the search itself failed (so the screen can say so) and [] when nothing matched. A database without the function yet (the Release N paste is
// pending) falls back to the older read-then-rank, which is only exact for words that match fewer than CANDIDATE_LIMIT foods.
export async function searchFoods(supabase: SupabaseClient, query: string, limit = SEARCH_RESULT_LIMIT): Promise<FoodHit[] | null> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const ranked = await supabase.rpc("search_usda_foods", { p_tokens: tokens, p_limit: limit });
  if (!ranked.error && Array.isArray(ranked.data)) {
    return (ranked.data as SearchRpcRow[]).slice(0, limit).map((r) => {
      const per100g: NutrientMap = {};
      if (r.kcal != null) per100g.kcal = Number(r.kcal);
      if (r.protein_g != null) per100g.protein_g = Number(r.protein_g);
      if (r.carbs_g != null) per100g.carbs_g = Number(r.carbs_g);
      if (r.fat_g != null) per100g.fat_g = Number(r.fat_g);
      return { fdcId: r.fdc_id, description: r.description, category: r.food_category ?? null, dataType: r.data_type ?? null, per100g };
    });
  }
  const missing = ranked.error && (ranked.error.code === "PGRST202" || ranked.error.code === "42883" || /search_usda_foods/.test(ranked.error.message ?? ""));
  if (!missing) return null;

  let q = supabase.from("usda_foods").select("fdc_id, description, data_type, food_category");
  for (const t of tokens) q = q.ilike("description", `%${escapeLike(t)}%`);
  const { data, error } = await q.limit(CANDIDATE_LIMIT);
  if (error || !data) return null;
  const top = rankFoodRows(data as FoodRow[], query, limit);
  if (top.length === 0) return [];
  const { data: nutrientRows } = await supabase
    .from("usda_food_nutrients")
    .select("fdc_id, nutrient_key, amount_per_100g")
    .in("fdc_id", top.map((r) => r.fdc_id))
    .in("nutrient_key", [...HIT_MACRO_KEYS]);
  const byFood = new Map<number, NutrientMap>();
  for (const n of (nutrientRows ?? []) as { fdc_id: number; nutrient_key: string; amount_per_100g: number }[]) {
    const m = byFood.get(n.fdc_id) ?? {};
    m[n.nutrient_key] = Number(n.amount_per_100g);
    byFood.set(n.fdc_id, m);
  }
  return top.map((r) => ({
    fdcId: r.fdc_id,
    description: r.description,
    category: r.food_category ?? null,
    dataType: r.data_type ?? null,
    per100g: byFood.get(r.fdc_id) ?? {},
  }));
}

export interface FoodDetail {
  fdcId: number;
  description: string;
  per100g: NutrientMap;
  portions: FoodPortion[];
}

// Everything the serving picker and the nutrient panel need for one food. Portions are optional: a database without them (or a food USDA has none for) simply offers grams and ounces.
export async function loadFoodDetail(supabase: SupabaseClient, fdcId: number): Promise<FoodDetail | null> {
  const { data: food, error } = await supabase.from("usda_foods").select("fdc_id, description").eq("fdc_id", fdcId).maybeSingle();
  if (error || !food) return null;
  const [{ data: nutrientRows }, { data: portionRows }] = await Promise.all([
    supabase.from("usda_food_nutrients").select("nutrient_key, amount_per_100g").eq("fdc_id", fdcId),
    supabase.from("usda_food_portions").select("seq, description, gram_weight").eq("fdc_id", fdcId).order("seq", { ascending: true }),
  ]);
  const per100g: NutrientMap = {};
  for (const n of (nutrientRows ?? []) as { nutrient_key: string; amount_per_100g: number }[]) per100g[n.nutrient_key] = Number(n.amount_per_100g);
  const portions: FoodPortion[] = ((portionRows ?? []) as { seq: number; description: string; gram_weight: number }[]).map((p) => ({
    seq: p.seq,
    description: p.description,
    gramWeight: Number(p.gram_weight),
  }));
  return { fdcId: food.fdc_id as number, description: food.description as string, per100g, portions };
}
