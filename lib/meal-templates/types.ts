export type FoodCategory = "proteins" | "starches" | "fats" | "produce" | "dairy";

export interface FoodDensity {
  protein: number;
  carbs: number;
  fat: number;
  category: FoodCategory;
}

export type Slot = "breakfast" | "lunch" | "dinner" | "snack";
export const SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];

export type DietType = "omnivore" | "vegetarian" | "vegan" | "keto" | "paleo" | "pescatarian" | "carnivore";
export const DIET_TYPES: DietType[] = ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian", "carnivore"];

export type ItemUnit = "g" | "large" | "slices" | "wraps" | "pieces" | "cakes";

// A preparation line (no food, no amount).
export interface TemplateNote {
  text: string;
}

// One food line of a meal. text is the line the client sees, written by the recipe ("<strong>Name:</strong> 120g"); an EMPTY text means the amount was too small to be
// worth showing, and such a line is not part of the meal (it is not displayed and not counted in the macros).
export interface TemplateIngredient {
  name: string;
  category: FoodCategory;
  qty: number;
  unit: ItemUnit;
  text: string;
}

export type TemplateItem = TemplateNote | TemplateIngredient;

export interface TemplateRecipe {
  id: string;
  name: string;
  slot: Slot;
  archetypes: DietType[];
  keywords: string[];
  build: (p: number, c: number, f: number) => TemplateItem[];
}

export const isIngredient = (item: TemplateItem): item is TemplateIngredient => "name" in item && typeof (item as TemplateIngredient).name === "string";
