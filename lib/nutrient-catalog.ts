import { KEY_12_NUTRIENTS } from "@/lib/nutrient-keys";

// Every nutrient the app can show beyond the four macros, in the order a person reads them, with a plain one-line "why it matters" and a few everyday foods that are good sources.
// The keys are the same names the USDA nutrients are stored under (usda_food_nutrients.nutrient_key) and the same keys a logged entry's nutrient snapshot uses, so the label of a
// custom food, the snapshot of a searched food and a reference intake all line up. A nutrient a food does not report is NEVER shown as zero (see lib/nutrient-day.ts).
//
// The wording is general nutrition information, never a diagnosis or a treatment: it says what a nutrient does in the body in a sentence, and the foods are ordinary ones. Food names
// are checked against the person's allergies and food rules before any is suggested (lib/nutrient-view.ts).

export type NutrientGroup = "vitamin" | "mineral" | "other";

// How the reference intake is used: "target" = more of it is the goal (an RDA or AI); "limit" = a level to stay under (sodium), shown as information only; "info" = no reference
// intake exists (saturated fat), shown as an amount only.
export type NutrientRole = "target" | "limit" | "info";

export interface CatalogNutrient {
  key: string;
  label: string;
  unit: string;
  group: NutrientGroup;
  role: NutrientRole;
  why: string;
  // Everyday foods that are good sources. Names only; the foods are filtered against the person's allergies and food rules before they are shown.
  goodSources: string[];
  // True for the nutrients the USDA records already carry in the app today (the 12 key nutrients); the rest appear as the fuller USDA data is loaded, and show "not reported" until then.
  inDatabaseToday: boolean;
}

const KEY12 = new Set(KEY_12_NUTRIENTS.map((n) => n.key));

const def = (key: string, label: string, unit: string, group: NutrientGroup, role: NutrientRole, why: string, goodSources: string[]): CatalogNutrient => ({
  key,
  label,
  unit,
  group,
  role,
  why,
  goodSources,
  inDatabaseToday: KEY12.has(key),
});

export const NUTRIENT_CATALOG: CatalogNutrient[] = [
  def("fiber_g", "Fiber", "g", "other", "target", "Fiber supports digestion and helps you feel full.", ["Oats", "Lentils", "Black beans", "Raspberries", "Chia seeds", "Pear", "Broccoli"]),
  def("potassium_mg", "Potassium", "mg", "mineral", "target", "Potassium helps muscles, nerves and fluid balance work normally.", ["Baked potato", "Banana", "White beans", "Spinach", "Plain yogurt", "Orange juice", "Avocado"]),
  def("calcium_mg", "Calcium", "mg", "mineral", "target", "Calcium builds and maintains bones and teeth and supports muscle and nerve function.", ["Plain yogurt", "Milk", "Fortified soy milk", "Tofu made with calcium", "Cheese", "Kale", "Canned sardines with bones"]),
  def("iron_mg", "Iron", "mg", "mineral", "target", "Iron helps carry oxygen in the blood.", ["Lean beef", "Lentils", "Spinach", "Fortified cereal", "Pumpkin seeds", "Tofu", "White beans"]),
  def("magnesium_mg", "Magnesium", "mg", "mineral", "target", "Magnesium supports muscle, nerve and energy function.", ["Pumpkin seeds", "Almonds", "Spinach", "Black beans", "Avocado", "Oats", "Peanut butter"]),
  def("zinc_mg", "Zinc", "mg", "mineral", "target", "Zinc supports the immune system and wound healing.", ["Beef", "Pumpkin seeds", "Chickpeas", "Cashews", "Oysters", "Yogurt", "Oats"]),
  def("phosphorus_mg", "Phosphorus", "mg", "mineral", "target", "Phosphorus works with calcium in bones and helps cells make energy.", ["Milk", "Yogurt", "Salmon", "Lentils", "Chicken breast", "Pumpkin seeds"]),
  def("copper_mcg", "Copper", "mcg", "mineral", "target", "Copper helps the body use iron and make connective tissue.", ["Sunflower seeds", "Cashews", "Shiitake mushrooms", "Chickpeas", "Dark chocolate", "Potatoes"]),
  def("manganese_mg", "Manganese", "mg", "mineral", "target", "Manganese helps with bone formation and with using carbohydrates and fats.", ["Oats", "Brown rice", "Pecans", "Pineapple", "Spinach", "Chickpeas"]),
  def("selenium_mcg", "Selenium", "mcg", "mineral", "target", "Selenium supports thyroid function and works as an antioxidant.", ["Tuna", "Eggs", "Chicken", "Sunflower seeds", "Brown rice", "Cottage cheese"]),
  def("iodine_mcg", "Iodine", "mcg", "mineral", "target", "Iodine is needed to make thyroid hormones.", ["Cod", "Plain yogurt", "Milk", "Eggs", "Iodized salt"]),
  def("vitamin_a_mcg", "Vitamin A", "mcg", "vitamin", "target", "Vitamin A supports vision, skin and the immune system.", ["Sweet potato", "Carrots", "Spinach", "Eggs", "Cantaloupe", "Milk"]),
  def("vitamin_c_mg", "Vitamin C", "mg", "vitamin", "target", "Vitamin C supports the immune system and helps the body absorb iron from plants.", ["Red bell pepper", "Orange", "Kiwi", "Strawberries", "Broccoli", "Grapefruit"]),
  def("vitamin_d_mcg", "Vitamin D", "mcg", "vitamin", "target", "Vitamin D helps the body absorb calcium and supports bones and muscles.", ["Salmon", "Trout", "Fortified milk", "Eggs", "Mushrooms exposed to UV light", "Fortified cereal"]),
  def("vitamin_e_mg", "Vitamin E", "mg", "vitamin", "target", "Vitamin E is an antioxidant that protects cells.", ["Sunflower seeds", "Almonds", "Spinach", "Avocado", "Peanut butter", "Hazelnuts"]),
  def("vitamin_k_mcg", "Vitamin K", "mcg", "vitamin", "target", "Vitamin K is needed for normal blood clotting and bone health.", ["Kale", "Spinach", "Broccoli", "Collard greens", "Brussels sprouts", "Green cabbage"]),
  def("thiamin_mg", "Thiamin (B1)", "mg", "vitamin", "target", "Thiamin helps the body turn food into energy.", ["Pork loin", "Sunflower seeds", "Black beans", "Whole grain bread", "Fortified cereal", "Trout"]),
  def("riboflavin_mg", "Riboflavin (B2)", "mg", "vitamin", "target", "Riboflavin helps the body turn food into energy and keeps skin and eyes healthy.", ["Milk", "Plain yogurt", "Eggs", "Almonds", "Beef", "Mushrooms"]),
  def("niacin_mg", "Niacin (B3)", "mg", "vitamin", "target", "Niacin helps the body turn food into energy.", ["Chicken breast", "Tuna", "Turkey", "Peanuts", "Mushrooms", "Brown rice"]),
  def("b6_mg", "Vitamin B6", "mg", "vitamin", "target", "Vitamin B6 helps the body use protein and make red blood cells.", ["Chickpeas", "Salmon", "Chicken breast", "Potatoes", "Banana", "Tuna"]),
  def("folate_mcg", "Folate", "mcg DFE", "vitamin", "target", "Folate helps the body make new cells and DNA.", ["Lentils", "Spinach", "Asparagus", "Black-eyed peas", "Fortified cereal", "Avocado", "Broccoli"]),
  def("b12_mcg", "Vitamin B12", "mcg", "vitamin", "target", "Vitamin B12 supports nerves and red blood cells. It comes mainly from animal foods and fortified foods.", ["Clams", "Beef", "Salmon", "Eggs", "Milk", "Plain yogurt", "Fortified nutritional yeast"]),
  def("choline_mg", "Choline", "mg", "other", "target", "Choline supports cell structure and nerve signalling.", ["Eggs", "Beef", "Chicken", "Soybeans", "Salmon", "Potatoes"]),
  def("sodium_mg", "Sodium", "mg", "mineral", "limit", "Sodium is needed in small amounts. Most people eat more than they need; this is shown against the level health authorities suggest staying under.", []),
  def("sat_fat_g", "Saturated fat", "g", "other", "info", "Health authorities suggest keeping saturated fat low as part of a balanced diet. There is no target to reach, so this is shown as an amount only.", []),
];

const BY_KEY = new Map(NUTRIENT_CATALOG.map((n) => [n.key, n]));
export const catalogNutrient = (key: string): CatalogNutrient | undefined => BY_KEY.get(key);

// The nutrients we compare with a reference intake to look for gaps: the ones where more of it is the goal.
export const TARGET_NUTRIENTS: CatalogNutrient[] = NUTRIENT_CATALOG.filter((n) => n.role === "target");

// The shorter list shown first: the nutrients people most often fall short of (the US Dietary Guidelines' nutrients of public health concern) that the database carries today.
export const HEADLINE_KEYS = ["fiber_g", "potassium_mg", "calcium_mg", "iron_mg", "vitamin_d_mcg", "magnesium_mg", "zinc_mg", "b12_mcg", "vitamin_c_mg", "folate_mcg"] as const;
