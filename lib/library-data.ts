// Everything the library-first builder reads from the database for one client, in one call: the coach's own recipes, the foods the client likes, what they have eaten (their
// favorites), and what they were offered in the last two weeks (so "mix it up" knows what to move down). Reads are soft: a failed read of a nice-to-have (likes, history) leaves
// that signal empty and says so; only the client's FOOD RULES are never read here (the screen already has them, and an unreadable set of rules stops a build before this).
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysBetweenKeys } from "@/lib/date-key";
import { favoriteSignals, FAVORITE_WINDOW_DAYS, type FavoriteSignals } from "@/lib/library-favorites";
import { libraryRecipeFromRow, type LibraryRecipe } from "@/lib/library-scaling";
import { choiceKey, mealRecipeChoices, type MealEntryPayload } from "@/lib/meal-plan-assignment";
import { addDaysToKey } from "@/lib/date-key";

export interface LibraryContextData {
  coachRecipes: LibraryRecipe[];
  likes: string[];
  variety: string | null;
  favorites: FavoriteSignals;
  recentlyOffered: Map<string, number>;
  // Plain sentences for anything that could not be read (shown quietly; the build still runs on what was read).
  notes: string[];
}

const NEW_COLUMNS = "source, main_protein";
const RECIPE_SELECT = (withNew: boolean) =>
  `id, name, slot, archetypes, keywords${withNew ? `, ${NEW_COLUMNS}` : ""}, recipe_ingredients ( id, sort_order, label, role, protein_per_100g, carbs_per_100g, fat_per_100g, fixed_display_text, usda_fdc_id${withNew ? ", grams_ref" : ""} )`;

// The offered keys of saved plans: key -> days from todayKey to the nearest plan day that offered it (a plan for next Tuesday counts as offered too).
export function offeredKeysFromPlans(plans: { log_date: string; meals: unknown }[], todayKey: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of plans) {
    const days = daysBetweenKeys(p.log_date, todayKey);
    if (days === null) continue;
    const age = Math.abs(days);
    const meals = p.meals as Record<string, MealEntryPayload[]> | null;
    if (!meals || typeof meals !== "object" || Array.isArray(meals)) continue;
    for (const entries of Object.values(meals)) {
      for (const entry of Array.isArray(entries) ? entries : []) {
        for (const choice of mealRecipeChoices(entry)) {
          const k = choiceKey(choice);
          if (!k) continue;
          const prev = out.get(k);
          if (prev === undefined || age < prev) out.set(k, age);
        }
      }
    }
  }
  return out;
}

export async function loadLibraryContext(supabase: SupabaseClient, args: { coachId: string; athleteId: string; todayKey: string }): Promise<LibraryContextData> {
  const notes: string[] = [];

  let coachRecipes: LibraryRecipe[] = [];
  {
    // Before the release's database step the new columns do not exist; the first select then fails and the older one is used.
    let res = await supabase.from("recipes").select(RECIPE_SELECT(true)).eq("created_by", args.coachId);
    if (res.error) res = await supabase.from("recipes").select(RECIPE_SELECT(false)).eq("created_by", args.coachId);
    if (res.error) notes.push("Your saved recipes could not be read, so only the starter library is used.");
    else coachRecipes = ((res.data ?? []) as unknown as Record<string, unknown>[]).map(libraryRecipeFromRow).filter((r): r is LibraryRecipe => !!r);
  }

  let likes: string[] = [];
  let variety: string | null = null;
  {
    const { data, error } = await supabase.from("client_nutrition_preferences").select("likes, variety").eq("athlete_id", args.athleteId).maybeSingle();
    if (error) notes.push("The foods this client likes could not be read, so they do not steer the menu.");
    else if (data) {
      likes = Array.isArray(data.likes) ? (data.likes as string[]) : [];
      variety = typeof data.variety === "string" ? data.variety : null;
    }
  }

  let favorites: FavoriteSignals = { ids: [], names: [] };
  {
    const from = addDaysToKey(args.todayKey, -FAVORITE_WINDOW_DAYS);
    const { data, error } = await supabase.from("food_log_entries").select("description, log_date").eq("athlete_id", args.athleteId).eq("status", "ate_it").gte("log_date", from);
    if (error) notes.push("What this client has eaten could not be read, so favorites are not used.");
    else favorites = favoriteSignals({ stars: [], eaten: (data ?? []).map((r) => ({ description: r.description as string | null, logDate: r.log_date as string })), todayKey: args.todayKey });
  }

  let recentlyOffered = new Map<string, number>();
  {
    const { data, error } = await supabase
      .from("meal_plans")
      .select("log_date, meals")
      .eq("athlete_id", args.athleteId)
      .gte("log_date", addDaysToKey(args.todayKey, -14))
      .lte("log_date", addDaysToKey(args.todayKey, 14));
    if (error) notes.push("The plans already made for this client could not be read, so repeats are not avoided.");
    else recentlyOffered = offeredKeysFromPlans((data ?? []) as { log_date: string; meals: unknown }[], args.todayKey);
  }

  return { coachRecipes, likes, variety, favorites, recentlyOffered, notes };
}
