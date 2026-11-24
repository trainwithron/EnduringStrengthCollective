import type { SupabaseClient } from "@supabase/supabase-js";
import { searchFoods, tokenize, type FoodHit } from "@/lib/food-search";
import { PACKAGED_RESULT_LIMIT, searchPackaged, type PackagedHit } from "@/lib/packaged-foods";

// One search of the food log (step 226, Ron Nov 23: "forgive spelling mistakes"): the everyday foods and the packaged ones at the same time, as before; only when BOTH find nothing,
// the words are read the way they were most likely meant (public.correct_food_search_words: a misspelled word swapped for the closest known food word; a word with a digit, a
// short word, or a word already known stays as typed) and the search runs once more. The screen then says "Showing results for chicken breast". Typing what you mean is never
// "corrected": a search that finds anything is shown as it is.

export interface FoodSearchResult {
  // null = the everyday search failed (the screen says so); [] = nothing matched
  hits: FoodHit[] | null;
  packaged: PackagedHit[];
  // the words searched instead of the ones typed, when the second try found something; otherwise null
  correctedTo: string | null;
}

// The words as they were most likely meant, when that differs from what was typed; null when nothing would change (or the check could not be done).
export async function correctFoodQuery(supabase: SupabaseClient, query: string): Promise<string | null> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  try {
    const { data, error } = await supabase.rpc("correct_food_search_words", { p_tokens: tokens });
    if (error || !Array.isArray(data)) return null;
    const fixed = (data as unknown[]).map((w) => String(w ?? "").trim()).filter((w) => w !== "");
    const text = fixed.join(" ");
    return fixed.length > 0 && text !== tokens.join(" ") ? text : null;
  } catch {
    return null;
  }
}

export async function runFoodSearch(supabase: SupabaseClient, query: string): Promise<FoodSearchResult> {
  const both = (q: string) => Promise.all([searchFoods(supabase, q), searchPackaged(supabase, q, PACKAGED_RESULT_LIMIT).catch(() => null)]);
  const [hits, packaged] = await both(query);
  const found: FoodSearchResult = { hits, packaged: packaged ?? [], correctedTo: null };
  // a failed everyday search is said as such, never "corrected"; anything found is shown as typed
  if (hits === null || hits.length > 0 || found.packaged.length > 0) return found;
  const fixed = await correctFoodQuery(supabase, query);
  if (!fixed) return found;
  const [hits2, packaged2] = await both(fixed);
  if ((hits2 && hits2.length > 0) || (packaged2 && packaged2.length > 0)) return { hits: hits2 ?? [], packaged: packaged2 ?? [], correctedTo: fixed };
  return found;
}
