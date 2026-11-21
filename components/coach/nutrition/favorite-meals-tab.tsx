import { createServerClient } from "@/lib/supabase/server";
import { MAX_STARRED_MEALS, rowToStarredMeal, type StarredMeal, type StarredRow } from "@/lib/starred-meals";
import { FavoriteMealsList, type FavoriteClient } from "@/components/coach/nutrition/favorite-meals-list";

// The "Favorite meals" tab of Nutrition (Ron, Nov 19: "the fav meals tab is not very usefull at all"): the meals the coach starred anywhere in Nutrition, newest first, each with
// its calories and protein and "Add to plan". The ingredient-by-ingredient recipe builder is gone from here (its one recipe was carried over as a starred meal, step 207).
// The built-in recipes' ingredient mapping is a platform admin's tool on /admin/nutrition-ingredients, never here (Ron, Nov 21). The tab itself shows only once a meal is starred
// (app/(coach)/groups/[groupId]/nutrition/page.tsx).
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

  return (
    <div>
      {starError ? (
        <p className="font-body text-sm text-rust-ink" role="alert">
          Couldn&apos;t load your favorite meals just now. Reload the page to try again.
        </p>
      ) : (
        <FavoriteMealsList initialMeals={meals} clients={clients} todayKey={todayKey} />
      )}
    </div>
  );
}
