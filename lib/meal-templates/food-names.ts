// Which diets each swappable food fits, and which food-table key each ingredient name stands for (docs/old-app/enduring-strength-checkin-engine.html (Mix & Macros), lines 915-997 and 1003-1033, copied as written).
// The port ADDS four names the old table did not map (see EXTRA_NAME_TO_KEY) so that every ingredient a recipe prints resolves to a food.
import type { DietType } from "./types";
import type { FoodKey } from "./food-table";

export const FOOD_ARCHETYPES: Record<string, DietType[]> = {
  // proteins
  chicken_breast:     ["omnivore", "paleo", "keto"],
  chicken_thigh:       ["omnivore", "paleo", "keto"],
  turkey_breast:       ["omnivore", "paleo", "keto"],
  ground_beef_80_20:   ["carnivore", "keto", "omnivore", "paleo"],
  ground_beef_90_10:   ["carnivore", "keto", "omnivore", "paleo"],
  ground_beef_93_7:    ["omnivore", "keto", "paleo"],
  sirloin_steak:       ["keto", "omnivore", "paleo", "carnivore"],
  ribeye_steak:        ["carnivore", "keto", "omnivore", "paleo"],
  ny_strip:            ["keto", "omnivore", "paleo", "carnivore"],
  flank_steak:         ["carnivore", "keto", "omnivore", "paleo"],
  chuck_roast:         ["keto", "omnivore", "paleo", "carnivore"],
  pork_tenderloin:     ["omnivore", "paleo", "keto"],
  salmon_raw:          ["keto", "omnivore", "paleo", "pescatarian"],
  shrimp_raw:          ["omnivore", "paleo", "pescatarian", "keto"],
  tuna_canned:         ["omnivore", "pescatarian", "keto", "paleo"],
  tofu_extra_firm:     ["vegan", "vegetarian"],
  tempeh_organic:      ["vegan", "vegetarian"],
  seitan:              ["vegan", "vegetarian"],
  egg_whole_large:     ["carnivore", "keto", "omnivore", "paleo", "pescatarian", "vegetarian"],
  whey_isolate:        ["omnivore", "paleo", "vegetarian", "keto"],
  casein_protein:      ["omnivore", "vegetarian", "keto"],
  plant_protein:       ["vegan", "vegetarian"],
  cottage_cheese_2pct: ["omnivore", "vegetarian"],
  beef_jerky:          ["carnivore", "keto", "omnivore", "paleo"],

  // carbs
  jasmine_rice_dry:    ["omnivore", "pescatarian", "vegan", "vegetarian"],
  sweet_potato_raw:    ["keto", "omnivore", "paleo", "vegan", "vegetarian"],
  potato_russet_raw:   ["keto", "omnivore", "paleo", "pescatarian"],
  quinoa_dry:          ["omnivore", "paleo", "pescatarian", "vegan", "vegetarian"],
  rolled_oats_dry:     ["omnivore", "vegan", "vegetarian"],
  cream_of_rice_dry:   ["omnivore", "paleo", "vegetarian", "vegan", "pescatarian"],
  black_beans_cooked:  ["omnivore", "vegan", "vegetarian"],
  honey_raw:           ["omnivore", "vegetarian", "pescatarian", "paleo"],
  fruit_juice_100:     ["omnivore", "vegetarian", "vegan", "pescatarian"],

  // produce (vegetables — low-carb enough for keto too)
  broccoli_raw:        ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"],
  asparagus_raw:       ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"],
  spinach_raw:         ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"],
  cabbage_green:       ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"],
  kale_raw:            ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"],
  carrots_raw:         ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  bell_pepper_raw:     ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"],
  zucchini_raw:        ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"],
  celery_raw:          ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"],
  beets_raw:           ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],

  // produce (fruits — too much sugar for keto, but paleo-friendly)
  apple_raw:           ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  pear_raw:             ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  banana_raw:           ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  pineapple_raw:        ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  berries_mixed:        ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  strawberries_raw:     ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  raspberries_raw:      ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  peach_raw:            ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  plum_raw:             ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  cherries_raw:         ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  kiwi_raw:             ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  grapefruit_raw:       ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  mango_raw:            ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  cantaloupe_raw:       ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  honeydew_raw:         ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  watermelon_raw:       ["omnivore", "vegetarian", "vegan", "paleo", "pescatarian"],
  sourdough_slice:     ["omnivore", "paleo", "pescatarian", "vegetarian", "vegan"],
  whole_wheat_wrap:    ["omnivore", "vegetarian", "vegan"],
  rice_cake:           ["omnivore", "pescatarian", "vegetarian", "vegan"],
  corn_flakes:         ["omnivore", "vegetarian"],

  // fats
  avocado_hass:        ["keto", "omnivore", "paleo", "pescatarian", "vegan", "vegetarian"],
  almonds_raw:         ["omnivore", "vegan", "vegetarian", "keto", "paleo"],
  walnuts_raw:         ["omnivore", "vegetarian", "keto", "paleo", "vegan"],
  peanut_butter_nat:   ["omnivore", "vegetarian", "vegan"],
  chia_seeds:          ["omnivore", "vegetarian", "vegan", "keto", "paleo"],
  pumpkin_seeds:       ["omnivore", "paleo", "vegan", "vegetarian", "keto"],
  butter_grassfed:     ["omnivore", "vegetarian", "keto", "paleo", "carnivore"],
  olive_oil_g:         ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"],
  sesame_oil_g:        ["omnivore", "vegetarian", "vegan", "keto", "paleo", "pescatarian"]
};

export const NAME_TO_KEY: Record<string, FoodKey> = {
  "Chicken Breast": "chicken_breast", "Chicken Thigh": "chicken_thigh", "Turkey Breast": "turkey_breast",
  "80/20 Ground Beef": "ground_beef_80_20", "90/10 Ground Beef": "ground_beef_90_10", "93/7 Ground Beef": "ground_beef_93_7",
  "Top Sirloin Steak": "sirloin_steak", "Ribeye Steak": "ribeye_steak", "New York Strip Steak": "ny_strip",
  "Flank Steak": "flank_steak", "Chuck Roast": "chuck_roast", "Pork Tenderloin": "pork_tenderloin",
  "Atlantic Salmon": "salmon_raw", "Raw Shrimp": "shrimp_raw", "Canned Tuna": "tuna_canned",
  "Extra Firm Tofu": "tofu_extra_firm", "Organic Tempeh": "tempeh_organic", "Seitan": "seitan",
  "Whole Eggs": "egg_whole_large", "Hard-Boiled Eggs": "egg_whole_large",
  "Whey Protein Isolate": "whey_isolate", "Casein Protein": "casein_protein",
  "Plant Protein Isolate": "plant_protein", "2% Cottage Cheese": "cottage_cheese_2pct", "Beef Jerky": "beef_jerky",

  "Jasmine White Rice": "jasmine_rice_dry", "Sweet Potato": "sweet_potato_raw", "Russet Potatoes": "potato_russet_raw",
  "Dry Quinoa": "quinoa_dry", "Rolled Oats (Dry)": "rolled_oats_dry", "Cream of Rice (Dry)": "cream_of_rice_dry",
  "Black Beans (Cooked)": "black_beans_cooked", "Sourdough Bread": "sourdough_slice",
  "Whole Wheat Wrap": "whole_wheat_wrap", "Rice Cakes": "rice_cake", "Corn Flakes": "corn_flakes",
  "Raw Honey": "honey_raw", "100% Fruit Juice": "fruit_juice_100",

  "Broccoli Florets": "broccoli_raw", "Asparagus": "asparagus_raw", "Baby Spinach": "spinach_raw",
  "Fresh Spinach": "spinach_raw", "Green Cabbage": "cabbage_green", "Kale": "kale_raw",
  "Carrots": "carrots_raw", "Bell Pepper": "bell_pepper_raw", "Zucchini": "zucchini_raw", "Celery": "celery_raw",

  "Apples": "apple_raw", "Raw Apple": "apple_raw", "Pears": "pear_raw", "Banana": "banana_raw",
  "Pineapple": "pineapple_raw", "Mixed Berries": "berries_mixed", "Strawberries": "strawberries_raw",
  "Raspberries": "raspberries_raw", "Fresh Peaches": "peach_raw", "Plums": "plum_raw", "Sweet Cherries": "cherries_raw",
  "Kiwi": "kiwi_raw", "Grapefruit": "grapefruit_raw", "Mangoes": "mango_raw", "Cantaloupe": "cantaloupe_raw",
  "Honeydew Melon": "honeydew_raw", "Watermelon": "watermelon_raw", "Beets": "beets_raw",

  "Hass Avocado": "avocado_hass", "Raw Almonds": "almonds_raw", "Raw Walnuts": "walnuts_raw",
  "Natural Peanut Butter": "peanut_butter_nat", "Chia Seeds": "chia_seeds", "Pumpkin Seeds": "pumpkin_seeds",
  "Grass-Fed Butter": "butter_grassfed", "Olive Oil": "olive_oil_g", "Sesame Oil": "sesame_oil_g"
};

// Added in the port: ingredients the recipes print that the old name table never mapped.
export const EXTRA_NAME_TO_KEY: Record<string, FoodKey> = {
  "Skim Milk": "milk_skim",
  "Liquid Egg Whites": "egg_whites_liquid",
  "0% Greek Yogurt": "greek_yogurt_0pct",
  "String Cheese": "string_cheese",
};

// Quick, sugar-heavy carbs offered as a swap only on a training day.
export const TRAINING_DAY_ONLY_KEYS: ReadonlySet<string> = new Set(["honey_raw", "fruit_juice_100"]);
