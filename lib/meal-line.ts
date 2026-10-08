// One counted food line of a meal as it is kept in a saved plan. name is the food (what the checks and the macros use); label is the line as it is printed. The structured fields
// (text, foodKey, category, qty, unit) are present on starter-library meals and are what the ingredient swap and the grocery list read; a line without them (a coach's own recipe,
// an AI option, a plan saved before they existed) still works everywhere else and simply cannot be swapped or counted on the grocery list by quantity.
export interface MealLine {
  name: string;
  label: string;
  grams: number | null;
  // The real food a saved line was matched to (its USDA description), when it has one.
  matched?: string;
  // The line exactly as it is printed on the plan (HTML-ish for a library meal), so a swap can replace the printed line.
  text?: string;
  // The food-table key the line stands for ("chicken_breast"), its category ("proteins"), and its amount in the unit it is counted in ("g", "large", "slices", ...).
  foodKey?: string;
  category?: "proteins" | "starches" | "fats" | "produce" | "dairy";
  qty?: number;
  unit?: "g" | "large" | "slices" | "wraps" | "pieces" | "cakes";
}

export const isStructuredLine = (l: MealLine): l is MealLine & Required<Pick<MealLine, "foodKey" | "category" | "qty" | "unit" | "text">> =>
  typeof l.foodKey === "string" && typeof l.category === "string" && typeof l.qty === "number" && typeof l.unit === "string" && typeof l.text === "string";

// A swap that was made on an option, kept with the plan so the coach (and the grocery list) can see what was changed.
export interface MealSwap {
  from: string;
  to: string;
}
