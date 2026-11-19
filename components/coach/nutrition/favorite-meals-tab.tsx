import { createServerClient } from "@/lib/supabase/server";
import { BuiltinIngredientMappings } from "@/components/coach/desktop/builtin-ingredient-mappings";
import { ALL_BUILTIN_INGREDIENT_KEYS, getBuiltinIngredientLabel } from "@/lib/builtin-recipe-ingredients";
import { MAX_STARRED_MEALS, rowToStarredMeal, type StarredMeal, type StarredRow } from "@/lib/starred-meals";
import { FavoriteMealsList, type FavoriteClient } from "@/components/coach/nutrition/favorite-meals-list";

// The "Favorite meals" tab of Nutrition (Ron, Nov 19: "the fav meals tab is not very usefull at all"): the meals the coach starred anywhere in Nutrition, newest first, each with
// its calories and protein and "Add to plan". The ingredient-by-ingredient recipe builder is gone from here (its one recipe was carried over as a starred meal, step 207).
// A platform admin also sees the shared mapping of the built-in recipes' ingredients (it changes every coach's clients' estimates).
export async function FavoriteMealsTab({ userId, clients, todayKey }: { userId: string; clients: FavoriteClient[]; todayKey: string }) {
  const supabase = await createServerClient();
  const { data: starRows, error: starError } = await supabase
    .from("recipe_favorites")
    .select("recipe_id, label, calories, protein_g, carbs_g, fat_g, meal")
    .eq("profile_id", userId)
    .eq("kind", "meal")
    .order("created_at", { ascending: false })
    .limit(MAX_STARRED_MEALS);
  if (starError) console.error("[favorite-meals] could not read starred meals:", starError.message);
  const meals: StarredMeal[] = ((starRows ?? []) as StarredRow[]).map(rowToStarredMeal).filter((m): m is StarredMeal => !!m);

  const { data: viewer } = await supabase.from("profiles").select("is_platform_admin").eq("id", userId).maybeSingle();
  const showBuiltinMappings = viewer?.is_platform_admin === true;
  let builtinRows: { key: string; label: string; usdaFdcId: number | null; usdaDescription: string | null }[] = [];
  if (showBuiltinMappings) {
    const { data: builtinMappingRows } = await supabase.from("builtin_ingredient_usda_mappings").select("ingredient_key, usda_fdc_id");
    const builtinMappingByKey = new Map((builtinMappingRows ?? []).map((r) => [r.ingredient_key, r.usda_fdc_id as number | null]));
    const builtinFdcIds = Array.from(new Set(Array.from(builtinMappingByKey.values()).filter((id): id is number => id != null)));
    const { data: builtinUsdaFoodRows } = builtinFdcIds.length
      ? await supabase.from("usda_foods").select("fdc_id, description").in("fdc_id", builtinFdcIds)
      : { data: [] as { fdc_id: number; description: string }[] };
    const builtinDescriptionByFdcId = new Map((builtinUsdaFoodRows ?? []).map((f) => [f.fdc_id, f.description]));
    builtinRows = ALL_BUILTIN_INGREDIENT_KEYS.map((key) => {
      const fdcId = builtinMappingByKey.get(key) ?? null;
      return { key, label: getBuiltinIngredientLabel(key), usdaFdcId: fdcId, usdaDescription: fdcId ? builtinDescriptionByFdcId.get(fdcId) ?? null : null };
    });
  }

  return (
    <div>
      {starError ? (
        <p className="font-body text-sm text-rust" role="alert">
          Couldn&apos;t load your favorite meals just now. Reload the page to try again.
        </p>
      ) : (
        <FavoriteMealsList initialMeals={meals} clients={clients} todayKey={todayKey} />
      )}

      {showBuiltinMappings && (
        <div className="pt-8 mt-8 border-t border-steel/20">
          <h2 className="font-display font-bold text-xl uppercase leading-none mb-2">Built-in recipe ingredients (platform admin)</h2>
          <p className="font-body text-sm text-steel mb-4 max-w-[70ch]">
            Map the 24 built-in recipes&apos; shared ingredient list to real USDA foods so every client&apos;s Key nutrients grid can estimate real micronutrients, not just macros.
            Shared across every coach on the platform.
          </p>
          <BuiltinIngredientMappings initialRows={builtinRows} />
        </div>
      )}
    </div>
  );
}
