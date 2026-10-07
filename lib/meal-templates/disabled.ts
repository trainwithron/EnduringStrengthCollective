// Templates that are NOT offered, and why. A template that cannot land inside the tolerance at any realistic target for the diets it declares is not shown (never
// "fixed" by redesigning Ron's recipe). The diagnostics test asserts this list is exactly the set that fails, so adding or removing a recipe forces a review here.
export const DISABLED_TEMPLATES: Record<string, string> = {
  s_jerky_eggs_carnivore:
    "Beef jerky and hard-boiled eggs hold at most about 16 g of fat (the formula caps the eggs at 3 and jerky has almost none), but a keto or carnivore snack aims for 18 to 50 g, so it misses the fat target by more than the tolerance at every size.",
};
