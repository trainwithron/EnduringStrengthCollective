// The food table of Ron's Mix & Macros app, copied as written (docs/old-app/enduring-strength-checkin-engine.html (Mix & Macros), lines 709-715 and 726-897). Per-gram macros and a category for every food, except the
// discrete foods (an egg, a slice of bread, a wrap, a rice cake, a bagel), whose numbers are PER UNIT. Nothing here was changed in the port; the port log
// (docs/NUTRITION_PORT_LOG.md) lists every difference and every check.
import type { FoodDensity } from "./types";

// Estimated weight of one unit, for foods counted in pieces.
export const UNIT_WEIGHT_G = {
  slices: 40,   // sourdough bread, average bakery slice
  wraps: 50,    // whole wheat wrap / tortilla
  large: 50,    // large egg, in-shell (USDA average)
  pieces: 24,   // string cheese stick
  cakes: 9      // plain rice cake
};

export const FOOD_DENSITY = {
  // PROTEINS
  ground_beef_80_20:   { protein: 0.19, carbs: 0, fat: 0.200, category: "proteins" },
  ground_beef_85_15:   { protein: 0.20, carbs: 0, fat: 0.150, category: "proteins" },
  ground_beef_90_10:   { protein: 0.182, carbs: 0, fat: 0.129, category: "proteins" }, // USDA fdc 2514743 (was 0.2 / 0 / 0.1)
  ground_beef_93_7:    { protein: 0.21, carbs: 0, fat: 0.075, category: "proteins" },
  ground_beef_96_4:    { protein: 0.22, carbs: 0, fat: 0.040, category: "proteins" },
  sirloin_steak:       { protein: 0.22, carbs: 0, fat: 0.060, category: "proteins" },
  flank_steak:         { protein: 0.21, carbs: 0, fat: 0.080, category: "proteins" },
  ribeye_steak:        { protein: 0.187, carbs: 0, fat: 0.184, category: "proteins" }, // USDA fdc 173403 (was 0.24 / 0 / 0.18)
  ny_strip:            { protein: 0.22, carbs: 0, fat: 0.100, category: "proteins" },
  filet_mignon:        { protein: 0.22, carbs: 0, fat: 0.050, category: "proteins" },
  skirt_steak:         { protein: 0.21, carbs: 0, fat: 0.120, category: "proteins" },
  chuck_roast:         { protein: 0.191, carbs: 0, fat: 0.186, category: "proteins" }, // USDA fdc 168668 (was 0.2 / 0 / 0.16)
  brisket:             { protein: 0.19, carbs: 0, fat: 0.220, category: "proteins" },
  flat_iron:           { protein: 0.22, carbs: 0, fat: 0.090, category: "proteins" },
  porterhouse:         { protein: 0.204, carbs: 0, fat: 0.146, category: "proteins" }, // USDA fdc 168715 (was 0.23 / 0 / 0.14)
  beef_jerky:          { protein: 0.332, carbs: 0.11, fat: 0.256, category: "proteins" }, // USDA fdc 167536 (was 0.5 / 0.05 / 0.05)

  chicken_breast:      { protein: 0.23, carbs: 0, fat: 0.025, category: "proteins" },
  chicken_thigh:       { protein: 0.20, carbs: 0, fat: 0.080, category: "proteins" },
  chicken_drumstick:   { protein: 0.19, carbs: 0, fat: 0.090, category: "proteins" },
  chicken_wing:        { protein: 0.175, carbs: 0, fat: 0.129, category: "proteins" }, // USDA fdc 172390 (was 0.18 / 0 / 0.16)
  chicken_tenderloin:  { protein: 0.23, carbs: 0, fat: 0.020, category: "proteins" },
  ground_turkey_93_7:  { protein: 0.173, carbs: 0, fat: 0.096, category: "proteins" }, // USDA fdc 2514747 (was 0.2 / 0 / 0.07)
  ground_turkey_99_1:  { protein: 0.24, carbs: 0, fat: 0.010, category: "proteins" },
  turkey_breast:       { protein: 0.24, carbs: 0, fat: 0.020, category: "proteins" },
  turkey_tenderloin:   { protein: 0.24, carbs: 0, fat: 0.020, category: "proteins" },

  pork_tenderloin:     { protein: 0.22, carbs: 0, fat: 0.040, category: "proteins" },
  pork_chop:           { protein: 0.22, carbs: 0, fat: 0.037, category: "proteins" }, // USDA fdc 167829 (was 0.22 / 0 / 0.07)
  pork_roast:          { protein: 0.21, carbs: 0, fat: 0.080, category: "proteins" },

  salmon_raw:          { protein: 0.20, carbs: 0, fat: 0.130, category: "proteins" },
  white_fish:          { protein: 0.19, carbs: 0, fat: 0.015, category: "proteins" },
  shrimp_raw:          { protein: 0.201, carbs: 0, fat: 0.005, category: "proteins" }, // USDA fdc 175179 (was 0.23 / 0 / 0.01)
  tuna_canned:         { protein: 0.25, carbs: 0, fat: 0.010, category: "proteins" },
  mahi_mahi:           { protein: 0.19, carbs: 0, fat: 0.010, category: "proteins" },
  halibut:             { protein: 0.186, carbs: 0, fat: 0.013, category: "proteins" }, // USDA fdc 174200 (was 0.21 / 0 / 0.02)
  scallops:            { protein: 0.121, carbs: 0.032, fat: 0.005, category: "proteins" }, // USDA fdc 174220 (was 0.21 / 0.02 / 0.01)

  egg_whole_large:     { protein: 6.3,  carbs: 0.4, fat: 5.000, category: "proteins" }, 
  egg_whites_liquid:   { protein: 0.11, carbs: 0.01, fat: 0, category: "proteins" },
  greek_yogurt_0pct:   { protein: 0.100, carbs: 0.04, fat: 0.005, category: "dairy" },
  cottage_cheese_2pct: { protein: 0.110, carbs: 0.04, fat: 0.020, category: "dairy" },
  ricotta_part_skim:   { protein: 0.110, carbs: 0.05, fat: 0.080, category: "dairy" },
  string_cheese:       { protein: 0.240, carbs: 0.03, fat: 0.180, category: "dairy" },
  milk_skim:           { protein: 0.034, carbs: 0.05, fat: 0.001, category: "dairy" },
  milk_whole:          { protein: 0.032, carbs: 0.05, fat: 0.033, category: "dairy" },
  milk_2_pct:          { protein: 0.033, carbs: 0.05, fat: 0.020, category: "dairy" },
  milk_almond_unsweet: { protein: 0.004, carbs: 0.01, fat: 0.012, category: "dairy" },
  milk_oat:            { protein: 0.010, carbs: 0.07, fat: 0.015, category: "dairy" },
  milk_soy_unsweet:    { protein: 0.028, carbs: 0.02, fat: 0.016, category: "dairy" },
  whey_isolate:        { protein: 0.85, carbs: 0.03, fat: 0.010, category: "proteins" },
  casein_protein:      { protein: 0.80, carbs: 0.05, fat: 0.010, category: "proteins" },
  pea_protein:         { protein: 0.80, carbs: 0.03, fat: 0.020, category: "proteins" },
  plant_protein:       { protein: 0.75, carbs: 0.06, fat: 0.030, category: "proteins" },

  tofu_extra_firm:     { protein: 0.10, carbs: 0.02, fat: 0.050, category: "proteins" },
  tempeh_organic:      { protein: 0.19, carbs: 0.09, fat: 0.110, category: "proteins" },
  seitan:              { protein: 0.25, carbs: 0.04, fat: 0.020, category: "proteins" },
  tvp_dry:             { protein: 0.51, carbs: 0.30, fat: 0.010, category: "proteins" },
  edamame:             { protein: 0.12, carbs: 0.09, fat: 0.050, category: "proteins" },

  // SUSTAINED BREAKFAST CARBS (70% Complex Base)
  rolled_oats_dry:     { carbs: 0.68, protein: 0.13, fat: 0.060, category: "starches" },
  sourdough_slice:     { carbs: 18.0, protein: 3.5,  fat: 0.800, category: "starches" },
  shredded_wheat:      { carbs: 0.70, protein: 0.10, fat: 0.020, category: "starches" },
  bran_flakes:         { carbs: 0.805, protein: 0.099, fat: 0.021, category: "starches" }, // USDA fdc 173888 (was 0.11 / 0.65 / 0.03)
  brown_rice_dry:      { carbs: 0.75, protein: 0.07, fat: 0.020, category: "starches" },
  whole_wheat_bread:   { carbs: 12.07, protein: 3.44, fat: 1.01, category: "starches" }, // USDA fdc 335240 (was 4 / 14 / 1)
  apple_raw:           { carbs: 0.14, protein: 0.01, fat: 0, category: "produce" },
  pear_raw:            { carbs: 0.15, protein: 0.01, fat: 0, category: "produce" },

  // QUICK-DIGESTING BREAKFAST CARBS (30% Simple Energy)
  cream_of_rice_dry:   { carbs: 0.80, protein: 0.07, fat: 0.010, category: "starches" },
  cream_of_wheat_dry:  { carbs: 0.75, protein: 0.10, fat: 0.010, category: "starches" },
  rice_krispies:       { carbs: 0.85, protein: 0.06, fat: 0.010, category: "starches" },
  corn_flakes:         { carbs: 0.84, protein: 0.07, fat: 0.010, category: "starches" },
  white_bread_slice:   { carbs: 13.0, protein: 2.5,  fat: 0.800, category: "starches" },
  bagel_plain:         { carbs: 50.0, protein: 9.0,  fat: 1.500, category: "starches" },
  applesauce_unsweet:  { carbs: 0.123, protein: 0.003, fat: 0.002, category: "produce" }, // USDA fdc 2263892 (was 0.01 / 0.15 / 0)
  grapes_raw:          { carbs: 0.18, protein: 0.01, fat: 0, category: "produce" },
  banana_raw:          { carbs: 0.23, protein: 0.01, fat: 0, category: "produce" },
  pineapple_raw:       { carbs: 0.13, protein: 0.01, fat: 0, category: "produce" },

  // GENERAL STARCHES
  jasmine_rice_dry:    { carbs: 0.80, protein: 0.07, fat: 0.010, category: "starches" },
  brown_rice_pasta:    { protein: 0.08, carbs: 0.75, fat: 0.020, category: "starches" },
  quinoa_dry:          { protein: 0.14, carbs: 0.64, fat: 0.060, category: "starches" },
  potato_russet_raw:   { carbs: 0.17, protein: 0.02, fat: 0, category: "starches" },
  sweet_potato_raw:    { carbs: 0.20, protein: 0.02, fat: 0, category: "starches" },
  whole_wheat_wrap:    { carbs: 22.95, protein: 4.9, fat: 4.9, category: "starches" }, // USDA fdc 174081 (was 5 / 22 / 3)
  rice_cake:           { carbs: 7.34, protein: 0.74, fat: 0.25, category: "starches" }, // USDA fdc 170250 (was 1 / 13 / 0.2)
  lentils_cooked:      { protein: 0.09, carbs: 0.20, fat: 0.010, category: "starches" },
  chickpeas_cooked:    { protein: 0.09, carbs: 0.27, fat: 0.030, category: "starches" },
  black_beans_cooked:  { protein: 0.09, carbs: 0.23, fat: 0.010, category: "starches" },
  honey_raw:           { carbs: 0.82, protein: 0.003, fat: 0, category: "starches" },
  fruit_juice_100:     { carbs: 0.11, protein: 0.005, fat: 0, category: "starches" },
  butternut_squash:    { carbs: 0.12, protein: 0.01, fat: 0, category: "produce" },

  // DIVERSE PRODUCE & FRUITS
  berries_mixed:       { carbs: 0.12, protein: 0.01, fat: 0, category: "produce" },
  strawberries_raw:    { carbs: 0.08, protein: 0.01, fat: 0, category: "produce" },
  blueberries_raw:     { carbs: 0.14, protein: 0.01, fat: 0, category: "produce" },
  raspberries_raw:     { carbs: 0.12, protein: 0.01, fat: 0, category: "produce" },
  blackberries_raw:    { carbs: 0.10, protein: 0.01, fat: 0, category: "produce" },
  peach_raw:           { carbs: 0.10, protein: 0.01, fat: 0, category: "produce" },
  nectarine_raw:       { carbs: 0.092, protein: 0.011, fat: 0.003, category: "produce" }, // USDA fdc 327357 (was 0.01 / 0.11 / 0)
  plum_raw:            { carbs: 0.11, protein: 0.01, fat: 0, category: "produce" },
  cherries_raw:        { carbs: 0.16, protein: 0.01, fat: 0, category: "produce" },
  kiwi_raw:            { carbs: 0.15, protein: 0.01, fat: 0.010, category: "produce" },
  orange_raw:          { carbs: 0.12, protein: 0.01, fat: 0, category: "produce" },
  lime_raw:            { carbs: 0.11, protein: 0.01, fat: 0, category: "produce" },
  lemon_raw:           { carbs: 0.09, protein: 0.01, fat: 0, category: "produce" },
  grapefruit_raw:      { carbs: 0.075, protein: 0.006, fat: 0.001, category: "produce" }, // USDA fdc 174675 (was 0.01 / 0.11 / 0)
  mango_raw:           { carbs: 0.15, protein: 0.01, fat: 0, category: "produce" },
  cantaloupe_raw:      { carbs: 0.08, protein: 0.01, fat: 0, category: "produce" },
  honeydew_raw:        { carbs: 0.09, protein: 0.01, fat: 0, category: "produce" },
  watermelon_raw:      { carbs: 0.08, protein: 0.01, fat: 0, category: "produce" },
  
  // VEGETABLES
  spinach_raw:         { carbs: 0.04, protein: 0.03, fat: 0, category: "produce" },
  broccoli_raw:        { carbs: 0.07, protein: 0.03, fat: 0, category: "produce" },
  cauliflower_raw:     { carbs: 0.05, protein: 0.02, fat: 0, category: "produce" },
  cabbage_green:       { carbs: 0.06, protein: 0.01, fat: 0, category: "produce" },
  kale_raw:            { carbs: 0.044, protein: 0.029, fat: 0.015, category: "produce" }, // USDA fdc 323505 (was 0.04 / 0.09 / 0)
  arugula_raw:         { carbs: 0.03, protein: 0.03, fat: 0, category: "produce" },
  swiss_chard_raw:     { carbs: 0.04, protein: 0.02, fat: 0, category: "produce" },
  collard_greens_raw:  { carbs: 0.05, protein: 0.03, fat: 0, category: "produce" },
  bok_choy_raw:        { carbs: 0.02, protein: 0.01, fat: 0, category: "produce" },
  brussels_sprouts:    { carbs: 0.09, protein: 0.03, fat: 0, category: "produce" },
  romaine_lettuce:     { carbs: 0.03, protein: 0.01, fat: 0, category: "produce" },
  radicchio_raw:       { carbs: 0.04, protein: 0.01, fat: 0, category: "produce" },
  carrots_raw:         { carbs: 0.10, protein: 0.01, fat: 0, category: "produce" },
  bell_pepper_raw:     { carbs: 0.06, protein: 0.01, fat: 0, category: "produce" },
  zucchini_raw:        { carbs: 0.03, protein: 0.01, fat: 0, category: "produce" },
  asparagus_raw:       { carbs: 0.04, protein: 0.02, fat: 0, category: "produce" },
  green_beans_raw:     { carbs: 0.07, protein: 0.02, fat: 0, category: "produce" },
  beets_raw:           { carbs: 0.10, protein: 0.02, fat: 0, category: "produce" },
  radishes_raw:        { carbs: 0.03, protein: 0.01, fat: 0, category: "produce" },
  turnips_raw:         { carbs: 0.06, protein: 0.01, fat: 0, category: "produce" },
  parsnips_raw:        { carbs: 0.18, protein: 0.01, fat: 0, category: "produce" },
  eggplant_raw:        { carbs: 0.06, protein: 0.01, fat: 0, category: "produce" },
  sugar_snap_peas:     { carbs: 0.08, protein: 0.03, fat: 0, category: "produce" },
  onions_raw:          { carbs: 0.09, protein: 0.01, fat: 0, category: "produce" },
  celery_raw:          { carbs: 0.03, protein: 0.01, fat: 0, category: "produce" },
  shallots_raw:        { carbs: 0.17, protein: 0.03, fat: 0, category: "produce" },
  leeks_raw:           { carbs: 0.14, protein: 0.02, fat: 0, category: "produce" },
  scallions_raw:       { carbs: 0.07, protein: 0.02, fat: 0, category: "produce" },
  fennel_bulb_raw:     { carbs: 0.055, protein: 0.009, fat: 0.001, category: "produce" }, // USDA fdc 2747655 (was 0.01 / 0.07 / 0)

  // JUICES
  juice_tart_cherry:   { protein: 0.010, carbs: 0.14, fat: 0, category: "produce" },
  juice_orange:        { protein: 0.007, carbs: 0.10, fat: 0, category: "produce" },
  juice_apple:         { protein: 0.001, carbs: 0.11, fat: 0, category: "produce" },
  juice_cranberry:     { protein: 0.004, carbs: 0.12, fat: 0, category: "produce" },
  coconut_water:       { protein: 0.002, carbs: 0.04, fat: 0, category: "produce" },

  // FATS & SEEDS
  avocado_hass:        { fat: 0.15, carbs: 0.08, protein: 0.02, category: "fats" },
  olive_oil_g:         { fat: 1.00, carbs: 0,    protein: 0, category: "fats" },
  sesame_oil_g:        { fat: 1.00, carbs: 0,    protein: 0, category: "fats" },
  butter_grassfed:     { fat: 0.82, carbs: 0,    protein: 0, category: "fats" },
  almonds_raw:         { fat: 0.50, carbs: 0.20, protein: 0.21, category: "fats" },
  walnuts_raw:         { fat: 0.697, carbs: 0.109, protein: 0.146, category: "fats" }, // USDA fdc 2346394 (was 0.15 / 0.14 / 0.65)
  macadamia_raw:       { fat: 0.76, carbs: 0.14, protein: 0.08, category: "fats" },
  chia_seeds:          { fat: 0.31, carbs: 0.42, protein: 0.17, category: "fats" },
  pumpkin_seeds:       { fat: 0.491, carbs: 0.107, protein: 0.302, category: "fats" }, // USDA fdc 170556 (was 0.3 / 0.18 / 0.46)
  hemp_seeds:          { fat: 0.49, carbs: 0.09, protein: 0.32, category: "fats" },
  peanut_butter_nat:   { fat: 0.50, carbs: 0.20, protein: 0.25, category: "fats" }
} satisfies Record<string, FoodDensity>;

export type FoodKey = keyof typeof FOOD_DENSITY;

// Foods whose density numbers are per UNIT (an egg, a slice, a wrap, a cake, a bagel), not per gram.
export const PER_UNIT_KEYS: ReadonlySet<string> = new Set(["egg_whole_large", "sourdough_slice", "whole_wheat_bread", "white_bread_slice", "bagel_plain", "whole_wheat_wrap", "rice_cake"]);
