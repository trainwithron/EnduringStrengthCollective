"use client";

import { useCallback, useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { FOOD_FAVORITES_CHANGED, mapFavoriteRow, type FoodFavorite } from "@/lib/food-favorites";
import { insertFoodLogEntry } from "@/lib/food-log-insert";
import type { FoodLogEntry } from "./meal-checkoff-list";

// One-tap re-log of a food the client starred. The macros are the ones saved when it was starred. Private to the client; logging from here is an ordinary
// entry and tells the coach nothing extra. Until the favorites update (0286) is applied the lookup fails quietly and nothing shows.
export function FavoriteFoodChips({
  athleteId,
  groupId,
  logDate,
  onLogged,
}: {
  athleteId: string;
  groupId: string;
  logDate: string;
  onLogged: (entry: FoodLogEntry) => void;
}) {
  const [favorites, setFavorites] = useState<FoodFavorite[]>([]);
  const [loggingKey, setLoggingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createBrowserClient();
    const { data, error: loadError } = await supabase
      .from("recipe_favorites")
      .select("recipe_id, label, calories, protein_g, carbs_g, fat_g")
      .eq("profile_id", athleteId)
      .eq("kind", "food")
      .order("created_at", { ascending: false })
      .limit(60);
    if (loadError) return;
    setFavorites(((data ?? []) as any[]).map(mapFavoriteRow).filter((f): f is FoodFavorite => !!f));
  }, [athleteId]);

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener(FOOD_FAVORITES_CHANGED, refresh);
    return () => window.removeEventListener(FOOD_FAVORITES_CHANGED, refresh);
  }, [load]);

  if (favorites.length === 0) return null;

  async function tap(f: FoodFavorite) {
    setLoggingKey(f.key);
    setError(null);
    const entry = await insertFoodLogEntry(createBrowserClient(), {
      athleteId,
      groupId,
      logDate,
      description: f.label,
      calories: f.calories,
      proteinG: f.proteinG,
      carbsG: f.carbsG,
      fatG: f.fatG,
    });
    setLoggingKey(null);
    if (!entry) {
      setError("That didn't log. Try again.");
      return;
    }
    onLogged(entry);
  }

  return (
    <div className="mb-2">
      <p className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">Favorites</p>
      <div className="flex flex-wrap gap-1.5">
        {favorites.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => tap(f)}
            disabled={loggingKey === f.key}
            title={`${Math.round(f.calories)} kcal`}
            className="h-11 px-2.5 border border-steel/30 text-chalk font-body text-xs active:border-rust active:text-rust transition-colors disabled:opacity-40"
          >
            {loggingKey === f.key ? "Logging…" : f.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="font-body text-xs text-rust mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
