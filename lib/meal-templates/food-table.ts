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
  ground_beef_80_20:   { protein: 0.175, carbs: 0, fat: 0.194, category: "proteins" }, // USDA fdc 2514744 (was 0.19 / 0 / 0.2)
  ground_beef_85_15:   { protein: 0.186, carbs: 0, fat: 0.15, category: "proteins" }, // USDA fdc 171796 (was 0.2 / 0 / 0.15)
  ground_beef_90_10:   { protein: 0.182, carbs: 0, fat: 0.129, category: "proteins" }, // USDA fdc 2514743 (was 0.2 / 0 / 0.1)
  ground_beef_93_7:    { protein: 0.209, carbs: 0, fat: 0.07, category: "proteins" }, // USDA fdc 173110 (was 0.21 / 0 / 0.075)
  ground_beef_96_4:    { protein: 0.214, carbs: 0, fat: 0.05, category: "proteins" }, // USDA fdc 171790 (was 0.22 / 0 / 0.04)
  sirloin_steak:       { protein: 0.22, carbs: 0, fat: 0.057, category: "proteins" }, // USDA fdc 2727574 (was 0.22 / 0 / 0.06)
  flank_steak:         { protein: 0.201, carbs: 0, fat: 0.094, category: "proteins" }, // USDA fdc 2646175 (was 0.21 / 0 / 0.08)
  ribeye_steak:        { protein: 0.187, carbs: 0, fat: 0.184, category: "proteins" }, // USDA fdc 173403 (was 0.24 / 0 / 0.18)
  ny_strip:            { protein: 0.206, carbs: 0, fat: 0.155, category: "proteins" }, // USDA fdc 169538 (was 0.22 / 0 / 0.1)
  filet_mignon:        { protein: 0.217, carbs: 0, fat: 0.067, category: "proteins" }, // USDA fdc 173988 (was 0.22 / 0 / 0.05)
  skirt_steak:         { protein: 0.204, carbs: 0, fat: 0.117, category: "proteins" }, // USDA fdc 172158 (was 0.21 / 0 / 0.12)
  chuck_roast:         { protein: 0.191, carbs: 0, fat: 0.186, category: "proteins" }, // USDA fdc 168668 (was 0.2 / 0 / 0.16)
  brisket:             { protein: 0.179, carbs: 0, fat: 0.222, category: "proteins" }, // USDA fdc 168666 (was 0.19 / 0 / 0.22)
  flat_iron:           { protein: 0.202, carbs: 0, fat: 0.073, category: "proteins" }, // USDA fdc 168693 (was 0.22 / 0 / 0.09)
  porterhouse:         { protein: 0.204, carbs: 0, fat: 0.146, category: "proteins" }, // USDA fdc 168715 (was 0.23 / 0 / 0.14)
  beef_jerky:          { protein: 0.332, carbs: 0.11, fat: 0.256, category: "proteins" }, // USDA fdc 167536 (was 0.5 / 0.05 / 0.05)

  chicken_breast:      { protein: 0.225, carbs: 0, fat: 0.026, category: "proteins" }, // USDA fdc 171077 (was 0.23 / 0 / 0.025)
  chicken_thigh:       { protein: 0.197, carbs: 0, fat: 0.041, category: "proteins" }, // USDA fdc 173627 (was 0.2 / 0 / 0.08)
  chicken_drumstick:   { protein: 0.194, carbs: 0, fat: 0.037, category: "proteins" }, // USDA fdc 173614 (was 0.19 / 0 / 0.09)
  chicken_wing:        { protein: 0.175, carbs: 0, fat: 0.129, category: "proteins" }, // USDA fdc 172390 (was 0.18 / 0 / 0.16)
  chicken_tenderloin:  { protein: 0.225, carbs: 0, fat: 0.026, category: "proteins" }, // USDA fdc 171077 (was 0.23 / 0 / 0.02)
  ground_turkey_93_7:  { protein: 0.173, carbs: 0, fat: 0.096, category: "proteins" }, // USDA fdc 2514747 (was 0.2 / 0 / 0.07)
  ground_turkey_99_1:  { protein: 0.236, carbs: 0, fat: 0.02, category: "proteins" }, // USDA fdc 172847 (was 0.24 / 0 / 0.01)
  turkey_breast:       { protein: 0.233, carbs: 0, fat: 0.023, category: "proteins" }, // USDA fdc 174515 (was 0.24 / 0 / 0.02)
  turkey_tenderloin:   { protein: 0.233, carbs: 0, fat: 0.023, category: "proteins" }, // USDA fdc 174515 (was 0.24 / 0 / 0.02)

  pork_tenderloin:     { protein: 0.207, carbs: 0, fat: 0.035, category: "proteins" }, // USDA fdc 168312 (was 0.22 / 0 / 0.04)
  pork_chop:           { protein: 0.22, carbs: 0, fat: 0.037, category: "proteins" }, // USDA fdc 167829 (was 0.22 / 0 / 0.07)
  pork_roast:          { protein: 0.174, carbs: 0, fat: 0.124, category: "proteins" }, // USDA fdc 167849 (was 0.21 / 0 / 0.08)

  salmon_raw:          { protein: 0.203, carbs: 0, fat: 0.131, category: "proteins" }, // USDA fdc 2684441 (was 0.2 / 0 / 0.13)
  white_fish:          { protein: 0.178, carbs: 0, fat: 0.007, category: "proteins" }, // USDA fdc 171955 (was 0.19 / 0 / 0.015)
  shrimp_raw:          { protein: 0.201, carbs: 0, fat: 0.005, category: "proteins" }, // USDA fdc 175179 (was 0.23 / 0 / 0.01)
  tuna_canned:         { protein: 0.255, carbs: 0, fat: 0.008, category: "proteins" }, // USDA fdc 171986 (was 0.25 / 0 / 0.01)
  mahi_mahi:           { protein: 0.185, carbs: 0, fat: 0.007, category: "proteins" }, // USDA fdc 171959 (was 0.19 / 0 / 0.01)
  halibut:             { protein: 0.186, carbs: 0, fat: 0.013, category: "proteins" }, // USDA fdc 174200 (was 0.21 / 0 / 0.02)
  scallops:            { protein: 0.121, carbs: 0.032, fat: 0.005, category: "proteins" }, // USDA fdc 174220 (was 0.21 / 0.02 / 0.01)

  egg_whole_large:     { protein: 6.3, carbs: 0.35, fat: 4.75, category: "proteins" }, // USDA fdc 171287 (was 6.3 / 0.4 / 5)
  egg_whites_liquid:   { protein: 0.109, carbs: 0.007, fat: 0.002, category: "proteins" }, // USDA fdc 172183 (was 0.11 / 0.01 / 0)
  greek_yogurt_0pct:   { protein: 0.103, carbs: 0.036, fat: 0.004, category: "dairy" }, // USDA fdc 330137 (was 0.1 / 0.04 / 0.005)
  cottage_cheese_2pct: { protein: 0.110, carbs: 0.04, fat: 0.020, category: "dairy" },
  ricotta_part_skim:   { protein: 0.114, carbs: 0.051, fat: 0.079, category: "dairy" }, // USDA fdc 171248 (was 0.11 / 0.05 / 0.08)
  string_cheese:       { protein: 0.237, carbs: 0.044, fat: 0.204, category: "dairy" }, // USDA fdc 329370 (was 0.24 / 0.03 / 0.18)
  milk_skim:           { protein: 0.034, carbs: 0.05, fat: 0.001, category: "dairy" },
  milk_whole:          { protein: 0.033, carbs: 0.047, fat: 0.032, category: "dairy" }, // USDA fdc 322892 (was 0.032 / 0.05 / 0.033)
  milk_2_pct:          { protein: 0.033, carbs: 0.05, fat: 0.020, category: "dairy" },
  milk_almond_unsweet: { protein: 0.006, carbs: 0.003, fat: 0.012, category: "dairy" }, // USDA fdc 1750338 (was 0.004 / 0.01 / 0.012)
  milk_oat:            { protein: 0.008, carbs: 0.051, fat: 0.027, category: "dairy" }, // USDA fdc 2257046 (was 0.01 / 0.07 / 0.015)
  milk_soy_unsweet:    { protein: 0.029, carbs: 0.017, fat: 0.017, category: "dairy" }, // USDA fdc 175223 (was 0.028 / 0.02 / 0.016)
  whey_isolate:        { protein: 0.85, carbs: 0.03, fat: 0.010, category: "proteins" },
  casein_protein:      { protein: 0.80, carbs: 0.05, fat: 0.010, category: "proteins" },
  pea_protein:         { protein: 0.80, carbs: 0.03, fat: 0.020, category: "proteins" },
  plant_protein:       { protein: 0.75, carbs: 0.06, fat: 0.030, category: "proteins" },

  tofu_extra_firm:     { protein: 0.173, carbs: 0.028, fat: 0.087, category: "proteins" }, // USDA fdc 172475 (was 0.1 / 0.02 / 0.05)
  tempeh_organic:      { protein: 0.203, carbs: 0.076, fat: 0.108, category: "proteins" }, // USDA fdc 174272 (was 0.19 / 0.09 / 0.11)
  seitan:              { protein: 0.25, carbs: 0.04, fat: 0.020, category: "proteins" },
  tvp_dry:             { protein: 0.51, carbs: 0.30, fat: 0.010, category: "proteins" },
  edamame:             { protein: 0.12, carbs: 0.09, fat: 0.050, category: "proteins" },

  // SUSTAINED BREAKFAST CARBS (70% Complex Base)
  rolled_oats_dry:     { carbs: 0.677, protein: 0.132, fat: 0.065, category: "starches" }, // USDA fdc 173904 (was 0.13 / 0.68 / 0.06)
  sourdough_slice:     { carbs: 20.76, protein: 4.32, fat: 0.96, category: "starches" }, // USDA fdc 172675 (was 3.5 / 18 / 0.8)
  shredded_wheat:      { carbs: 0.70, protein: 0.10, fat: 0.020, category: "starches" },
  bran_flakes:         { carbs: 0.805, protein: 0.099, fat: 0.021, category: "starches" }, // USDA fdc 173888 (was 0.11 / 0.65 / 0.03)
  brown_rice_dry:      { carbs: 0.763, protein: 0.075, fat: 0.032, category: "starches" }, // USDA fdc 169703 (was 0.07 / 0.75 / 0.02)
  whole_wheat_bread:   { carbs: 12.07, protein: 3.44, fat: 0.99, category: "starches" }, // USDA fdc 335240 (was 4 / 14 / 1)
  apple_raw:           { carbs: 0.138, protein: 0.003, fat: 0.002, category: "produce" }, // USDA fdc 171688 (was 0.01 / 0.14 / 0)
  pear_raw:            { carbs: 0.151, protein: 0.004, fat: 0.002, category: "produce" }, // USDA fdc 746773 (was 0.01 / 0.15 / 0)

  // QUICK-DIGESTING BREAKFAST CARBS (30% Simple Energy)
  cream_of_rice_dry:   { carbs: 0.824, protein: 0.063, fat: 0.005, category: "starches" }, // USDA fdc 173900 (was 0.07 / 0.8 / 0.01)
  cream_of_wheat_dry:  { carbs: 0.78, protein: 0.106, fat: 0.005, category: "starches" }, // USDA fdc 173916 (was 0.1 / 0.75 / 0.01)
  rice_krispies:       { carbs: 0.85, protein: 0.06, fat: 0.010, category: "starches" },
  corn_flakes:         { carbs: 0.84, protein: 0.07, fat: 0.010, category: "starches" },
  white_bread_slice:   { carbs: 12.3, protein: 2.35, fat: 0.9, category: "starches" }, // USDA fdc 325871 (was 2.5 / 13 / 0.8)
  bagel_plain:         { carbs: 52.4, protein: 10.6, fat: 1.3, category: "starches" }, // USDA fdc 174899 (was 9 / 50 / 1.5)
  applesauce_unsweet:  { carbs: 0.123, protein: 0.003, fat: 0.002, category: "produce" }, // USDA fdc 2263892 (was 0.01 / 0.15 / 0)
  grapes_raw:          { carbs: 0.181, protein: 0.007, fat: 0.002, category: "produce" }, // USDA fdc 174683 (was 0.01 / 0.18 / 0)
  banana_raw:          { carbs: 0.228, protein: 0.011, fat: 0.003, category: "produce" }, // USDA fdc 173944 (was 0.01 / 0.23 / 0)
  pineapple_raw:       { carbs: 0.131, protein: 0.005, fat: 0.001, category: "produce" }, // USDA fdc 169124 (was 0.01 / 0.13 / 0)

  // GENERAL STARCHES
  jasmine_rice_dry:    { carbs: 0.8, protein: 0.071, fat: 0.007, category: "starches" }, // USDA fdc 168877 (was 0.07 / 0.8 / 0.01)
  brown_rice_pasta:    { protein: 0.08, carbs: 0.75, fat: 0.020, category: "starches" },
  quinoa_dry:          { protein: 0.141, carbs: 0.642, fat: 0.061, category: "starches" }, // USDA fdc 168874 (was 0.14 / 0.64 / 0.06)
  potato_russet_raw:   { carbs: 0.181, protein: 0.021, fat: 0.001, category: "starches" }, // USDA fdc 170027 (was 0.02 / 0.17 / 0)
  sweet_potato_raw:    { carbs: 0.201, protein: 0.016, fat: 0.001, category: "starches" }, // USDA fdc 168482 (was 0.02 / 0.2 / 0)
  whole_wheat_wrap:    { carbs: 22.95, protein: 4.88, fat: 4.88, category: "starches" }, // USDA fdc 174081 (was 5 / 22 / 3)
  rice_cake:           { carbs: 7.33, protein: 0.74, fat: 0.25, category: "starches" }, // USDA fdc 170250 (was 1 / 13 / 0.2)
  lentils_cooked:      { protein: 0.09, carbs: 0.201, fat: 0.004, category: "starches" }, // USDA fdc 172421 (was 0.09 / 0.2 / 0.01)
  chickpeas_cooked:    { protein: 0.089, carbs: 0.274, fat: 0.026, category: "starches" }, // USDA fdc 173757 (was 0.09 / 0.27 / 0.03)
  black_beans_cooked:  { protein: 0.089, carbs: 0.237, fat: 0.005, category: "starches" }, // USDA fdc 173735 (was 0.09 / 0.23 / 0.01)
  honey_raw:           { carbs: 0.824, protein: 0.003, fat: 0, category: "starches" }, // USDA fdc 169640 (was 0.003 / 0.82 / 0)
  fruit_juice_100:     { carbs: 0.113, protein: 0.001, fat: 0.001, category: "starches" }, // USDA fdc 167771 (was 0.005 / 0.11 / 0)
  butternut_squash:    { carbs: 0.105, protein: 0.011, fat: 0.002, category: "produce" }, // USDA fdc 2685570 (was 0.01 / 0.12 / 0)

  // DIVERSE PRODUCE & FRUITS
  berries_mixed:       { carbs: 0.12, protein: 0.01, fat: 0, category: "produce" },
  strawberries_raw:    { carbs: 0.076, protein: 0.006, fat: 0.002, category: "produce" }, // USDA fdc 327699 (was 0.01 / 0.08 / 0)
  blueberries_raw:     { carbs: 0.146, protein: 0.007, fat: 0.003, category: "produce" }, // USDA fdc 2263889 (was 0.01 / 0.14 / 0)
  raspberries_raw:     { carbs: 0.129, protein: 0.01, fat: 0.002, category: "produce" }, // USDA fdc 2263888 (was 0.01 / 0.12 / 0)
  blackberries_raw:    { carbs: 0.096, protein: 0.014, fat: 0.005, category: "produce" }, // USDA fdc 173946 (was 0.01 / 0.1 / 0)
  peach_raw:           { carbs: 0.101, protein: 0.009, fat: 0.003, category: "produce" }, // USDA fdc 325430 (was 0.01 / 0.1 / 0)
  nectarine_raw:       { carbs: 0.092, protein: 0.011, fat: 0.003, category: "produce" }, // USDA fdc 327357 (was 0.01 / 0.11 / 0)
  plum_raw:            { carbs: 0.114, protein: 0.007, fat: 0.003, category: "produce" }, // USDA fdc 169949 (was 0.01 / 0.11 / 0)
  cherries_raw:        { carbs: 0.16, protein: 0.011, fat: 0.002, category: "produce" }, // USDA fdc 171719 (was 0.01 / 0.16 / 0)
  kiwi_raw:            { carbs: 0.14, protein: 0.011, fat: 0.004, category: "produce" }, // USDA fdc 327046 (was 0.01 / 0.15 / 0.01)
  orange_raw:          { carbs: 0.118, protein: 0.009, fat: 0.001, category: "produce" }, // USDA fdc 169097 (was 0.01 / 0.12 / 0)
  lime_raw:            { carbs: 0.105, protein: 0.007, fat: 0.002, category: "produce" }, // USDA fdc 168155 (was 0.01 / 0.11 / 0)
  lemon_raw:           { carbs: 0.093, protein: 0.011, fat: 0.003, category: "produce" }, // USDA fdc 167746 (was 0.01 / 0.09 / 0)
  grapefruit_raw:      { carbs: 0.075, protein: 0.006, fat: 0.001, category: "produce" }, // USDA fdc 174675 (was 0.01 / 0.11 / 0)
  mango_raw:           { carbs: 0.15, protein: 0.008, fat: 0.004, category: "produce" }, // USDA fdc 169910 (was 0.01 / 0.15 / 0)
  cantaloupe_raw:      { carbs: 0.082, protein: 0.008, fat: 0.002, category: "produce" }, // USDA fdc 327198 (was 0.01 / 0.08 / 0)
  honeydew_raw:        { carbs: 0.081, protein: 0.005, fat: 0.002, category: "produce" }, // USDA fdc 2710816 (was 0.01 / 0.09 / 0)
  watermelon_raw:      { carbs: 0.076, protein: 0.006, fat: 0.002, category: "produce" }, // USDA fdc 167765 (was 0.01 / 0.08 / 0)
  
  // VEGETABLES
  spinach_raw:         { carbs: 0.036, protein: 0.029, fat: 0.004, category: "produce" }, // USDA fdc 168462 (was 0.03 / 0.04 / 0)
  broccoli_raw:        { carbs: 0.063, protein: 0.026, fat: 0.003, category: "produce" }, // USDA fdc 321900 (was 0.03 / 0.07 / 0)
  cauliflower_raw:     { carbs: 0.047, protein: 0.016, fat: 0.002, category: "produce" }, // USDA fdc 2685573 (was 0.02 / 0.05 / 0)
  cabbage_green:       { carbs: 0.058, protein: 0.013, fat: 0.001, category: "produce" }, // USDA fdc 169975 (was 0.01 / 0.06 / 0)
  kale_raw:            { carbs: 0.044, protein: 0.029, fat: 0.015, category: "produce" }, // USDA fdc 323505 (was 0.04 / 0.09 / 0)
  arugula_raw:         { carbs: 0.037, protein: 0.026, fat: 0.007, category: "produce" }, // USDA fdc 169387 (was 0.03 / 0.03 / 0)
  swiss_chard_raw:     { carbs: 0.037, protein: 0.018, fat: 0.002, category: "produce" }, // USDA fdc 169991 (was 0.02 / 0.04 / 0)
  collard_greens_raw:  { carbs: 0.07, protein: 0.03, fat: 0.008, category: "produce" }, // USDA fdc 2685574 (was 0.03 / 0.05 / 0)
  bok_choy_raw:        { carbs: 0.022, protein: 0.015, fat: 0.002, category: "produce" }, // USDA fdc 170390 (was 0.01 / 0.02 / 0)
  brussels_sprouts:    { carbs: 0.096, protein: 0.04, fat: 0.006, category: "produce" }, // USDA fdc 2685575 (was 0.03 / 0.09 / 0)
  romaine_lettuce:     { carbs: 0.032, protein: 0.012, fat: 0.003, category: "produce" }, // USDA fdc 327923 (was 0.01 / 0.03 / 0)
  radicchio_raw:       { carbs: 0.05, protein: 0.013, fat: 0.001, category: "produce" }, // USDA fdc 2747664 (was 0.01 / 0.04 / 0)
  carrots_raw:         { carbs: 0.096, protein: 0.009, fat: 0.002, category: "produce" }, // USDA fdc 170393 (was 0.01 / 0.1 / 0)
  bell_pepper_raw:     { carbs: 0.046, protein: 0.009, fat: 0.002, category: "produce" }, // USDA fdc 170427 (was 0.01 / 0.06 / 0)
  zucchini_raw:        { carbs: 0.031, protein: 0.012, fat: 0.003, category: "produce" }, // USDA fdc 169291 (was 0.01 / 0.03 / 0)
  asparagus_raw:       { carbs: 0.039, protein: 0.022, fat: 0.001, category: "produce" }, // USDA fdc 168389 (was 0.02 / 0.04 / 0)
  green_beans_raw:     { carbs: 0.074, protein: 0.02, fat: 0.003, category: "produce" }, // USDA fdc 2346400 (was 0.02 / 0.07 / 0)
  beets_raw:           { carbs: 0.088, protein: 0.017, fat: 0.003, category: "produce" }, // USDA fdc 2685576 (was 0.02 / 0.1 / 0)
  radishes_raw:        { carbs: 0.034, protein: 0.007, fat: 0.001, category: "produce" }, // USDA fdc 169276 (was 0.01 / 0.03 / 0)
  turnips_raw:         { carbs: 0.073, protein: 0.01, fat: 0.001, category: "produce" }, // USDA fdc 2747674 (was 0.01 / 0.06 / 0)
  parsnips_raw:        { carbs: 0.193, protein: 0.013, fat: 0.005, category: "produce" }, // USDA fdc 2747659 (was 0.01 / 0.18 / 0)
  eggplant_raw:        { carbs: 0.054, protein: 0.009, fat: 0.001, category: "produce" }, // USDA fdc 2685577 (was 0.01 / 0.06 / 0)
  sugar_snap_peas:     { carbs: 0.076, protein: 0.028, fat: 0.002, category: "produce" }, // USDA fdc 170010 (was 0.03 / 0.08 / 0)
  onions_raw:          { carbs: 0.093, protein: 0.011, fat: 0.001, category: "produce" }, // USDA fdc 170000 (was 0.01 / 0.09 / 0)
  celery_raw:          { carbs: 0.033, protein: 0.005, fat: 0.002, category: "produce" }, // USDA fdc 2346405 (was 0.01 / 0.03 / 0)
  shallots_raw:        { carbs: 0.168, protein: 0.025, fat: 0.001, category: "produce" }, // USDA fdc 170499 (was 0.03 / 0.17 / 0)
  leeks_raw:           { carbs: 0.142, protein: 0.015, fat: 0.003, category: "produce" }, // USDA fdc 169246 (was 0.02 / 0.14 / 0)
  scallions_raw:       { carbs: 0.073, protein: 0.018, fat: 0.002, category: "produce" }, // USDA fdc 170005 (was 0.02 / 0.07 / 0)
  fennel_bulb_raw:     { carbs: 0.055, protein: 0.009, fat: 0.001, category: "produce" }, // USDA fdc 2747655 (was 0.01 / 0.07 / 0)

  // JUICES
  juice_tart_cherry:   { protein: 0.003, carbs: 0.137, fat: 0.005, category: "produce" }, // USDA fdc 167807 (was 0.01 / 0.14 / 0)
  juice_orange:        { protein: 0.007, carbs: 0.104, fat: 0.002, category: "produce" }, // USDA fdc 169098 (was 0.007 / 0.1 / 0)
  juice_apple:         { protein: 0.001, carbs: 0.113, fat: 0.001, category: "produce" }, // USDA fdc 167771 (was 0.001 / 0.11 / 0)
  juice_cranberry:     { protein: 0.004, carbs: 0.122, fat: 0.001, category: "produce" }, // USDA fdc 168117 (was 0.004 / 0.12 / 0)
  coconut_water:       { protein: 0.007, carbs: 0.037, fat: 0.002, category: "produce" }, // USDA fdc 170174 (was 0.002 / 0.04 / 0)

  // FATS & SEEDS
  avocado_hass:        { fat: 0.154, carbs: 0.086, protein: 0.02, category: "fats" }, // USDA fdc 171706 (was 0.02 / 0.08 / 0.15)
  olive_oil_g:         { fat: 1, carbs: 0, protein: 0, category: "fats" }, // USDA fdc 171413 (was 0 / 0 / 1)
  sesame_oil_g:        { fat: 1, carbs: 0, protein: 0, category: "fats" }, // USDA fdc 171016 (was 0 / 0 / 1)
  butter_grassfed:     { fat: 0.811, carbs: 0.001, protein: 0.009, category: "fats" }, // USDA fdc 173410 (was 0 / 0 / 0.82)
  almonds_raw:         { fat: 0.511, carbs: 0.2, protein: 0.215, category: "fats" }, // USDA fdc 2346393 (was 0.21 / 0.2 / 0.5)
  walnuts_raw:         { fat: 0.697, carbs: 0.109, protein: 0.146, category: "fats" }, // USDA fdc 2346394 (was 0.15 / 0.14 / 0.65)
  macadamia_raw:       { fat: 0.758, carbs: 0.138, protein: 0.079, category: "fats" }, // USDA fdc 170178 (was 0.08 / 0.14 / 0.76)
  chia_seeds:          { fat: 0.307, carbs: 0.421, protein: 0.165, category: "fats" }, // USDA fdc 170554 (was 0.17 / 0.42 / 0.31)
  pumpkin_seeds:       { fat: 0.491, carbs: 0.107, protein: 0.302, category: "fats" }, // USDA fdc 170556 (was 0.3 / 0.18 / 0.46)
  hemp_seeds:          { fat: 0.488, carbs: 0.087, protein: 0.316, category: "fats" }, // USDA fdc 170148 (was 0.32 / 0.09 / 0.49)
  peanut_butter_nat:   { fat: 0.514, carbs: 0.223, protein: 0.222, category: "fats" } // USDA fdc 172470 (was 0.25 / 0.2 / 0.5)
} satisfies Record<string, FoodDensity>;

export type FoodKey = keyof typeof FOOD_DENSITY;

// Foods whose density numbers are per UNIT (an egg, a slice, a wrap, a cake, a bagel), not per gram.
export const PER_UNIT_KEYS: ReadonlySet<string> = new Set(["egg_whole_large", "sourdough_slice", "whole_wheat_bread", "white_bread_slice", "bagel_plain", "whole_wheat_wrap", "rice_cake"]);
