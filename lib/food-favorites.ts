// Favorite foods (Ron, Oct 6): star something you logged, log it again in one tap. A favorite keeps the macros it had when it was starred. It is private to
// the client (the coach never sees favorites), and starring or logging from one tells nobody anything.

export const MAX_FOOD_FAVORITES = 60;
export const FOOD_FAVORITES_CHANGED = "food-favorites-changed";

export interface FoodFavorite {
  key: string; // the recipe_favorites.recipe_id of this row
  label: string;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

// The same food typed a little differently ("Chipotle bowl", " chipotle  bowl ") is one favorite.
export function foodFavoriteKey(label: string): string {
  return `food:${label.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export interface FavoriteRow {
  recipe_id: string;
  label: string | null;
  calories: number | string | null;
  protein_g: number | string | null;
  carbs_g: number | string | null;
  fat_g: number | string | null;
}

const num = (v: number | string | null): number | null => (v == null || v === "" ? null : Number(v));

export function mapFavoriteRow(r: FavoriteRow): FoodFavorite | null {
  const calories = num(r.calories);
  if (!r.label || !r.label.trim() || calories == null || Number.isNaN(calories)) return null;
  return { key: r.recipe_id, label: r.label.trim(), calories, proteinG: num(r.protein_g), carbsG: num(r.carbs_g), fatG: num(r.fat_g) };
}

// What a logged entry would be saved as: needs a name and calories (an entry with neither cannot be favorited).
export function favoriteFromEntry(entry: {
  description: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}, fallbackLabel?: string | null): FoodFavorite | null {
  const label = (entry.description?.trim() || fallbackLabel?.trim() || "").slice(0, 200);
  if (!label || entry.calories == null || entry.calories < 0) return null;
  return { key: foodFavoriteKey(label), label, calories: entry.calories, proteinG: entry.proteinG, carbsG: entry.carbsG, fatG: entry.fatG };
}
