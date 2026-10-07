// Templates that are NOT offered, and why. A template that cannot land inside the tolerance at any realistic target for the diets it declares is not shown (never
// "fixed" by redesigning Ron's recipe). The diagnostics test asserts this list is exactly the set that fails, so adding or removing a recipe forces a review here.
export const DISABLED_TEMPLATES: Record<string, string> = {
  s_jerky_eggs_carnivore:
    "Beef jerky and hard-boiled eggs hold at most about 16 g of fat (the formula caps the eggs at 3 and jerky has almost none), but a keto or carnivore snack aims for 18 to 50 g, so it misses the fat target by more than the tolerance at every size.",
  l_chuck_roast_sweet_potato_bowl:
    "With the USDA values for chuck roast (about 19 g protein and 19 g fat per 100 g, nearly one gram of fat for every gram of protein) the bowl holds more fat than any lunch target allows once its protein is met, so it misses the fat target by more than the tolerance at every size.",
  d_chuck_roast_root_veggie_dinner:
    "With the USDA values for chuck roast (about 19 g protein and 19 g fat per 100 g) the dinner holds more fat than any dinner target allows once its protein is met, so it misses the fat target by more than the tolerance at every size.",
  s_string_cheese_jerky_apple:
    "With the USDA values for beef jerky (about 33 g protein, 11 g carbs and 26 g fat per 100 g) the jerky alone brings more fat than a snack target allows once the snack's protein is met, so it misses the fat target by more than the tolerance at every size.",
  s_cantaloupe_jerky:
    "With the USDA values for beef jerky (about 33 g protein, 11 g carbs and 26 g fat per 100 g) the jerky brings more fat than a snack target allows once the snack's protein is met, so it misses the fat target by more than the tolerance at every size.",
  b_salmon_eggs_avocado:
    "Salmon, whole eggs and avocado together carry more fat than any breakfast target allows once the protein is met (with USDA values the salmon alone is 20 g protein and 13 g fat per 100 g, an egg adds about 5 g of fat, and the avocado 15 g per 100 g), so it misses the fat target by more than the tolerance at every size. Before the correction it landed on a single keto size.",
};
