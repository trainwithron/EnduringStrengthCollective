// Foods that a recipe's PREPARATION TEXT names but that are not an ingredient line. A line is what gets counted, shown in grams and checked against a client's rules; a food
// named only in the preparation text is not counted (the old app never counted it), so every such food is DECLARED here with the reason, and the allergen and diet tags
// read the preparation text as well as the lines (see tags.ts). The diagnostics test fails when the preparation text names a seasoning or an allergen food that is neither a
// line nor declared here, and when a declaration here no longer matches the text.
export const DECLARED_PREP_FOODS: Record<string, { foods: string[]; reason: string }> = {
  b_ny_strip_eggs_cor: { foods: ["water"], reason: "Water to cook the cream of rice: no calories." },
  b_cherry_oats: { foods: ["vanilla"], reason: "Only the flavour of the whey line (vanilla whey): nothing extra is added." },
  b_tofu_scramble_berries_vegan: { foods: ["turmeric", "nutritional yeast"], reason: "Seasonings for the tofu; a spoonful of nutritional yeast is a few calories." },
  b_ribeye_eggs_carnivore: { foods: ["salt"], reason: "Salt to season the meat; no calories counted." },
  b_chicken_sweet_potato_hash: { foods: ["paprika", "pepper"], reason: "Seasonings; no calories counted." },
  b_berry_almond_whey_bowl: { foods: ["water"], reason: "A splash of water in the shake: no calories." },
  b_tempeh_oat_bowl_vegan: { foods: ["cinnamon"], reason: "Seasoning." },
  b_casein_overnight_pudding: { foods: ["water", "milk"], reason: "The casein can be mixed with water OR milk; the recipe counts the water version, so milk is optional and not counted." },
  l_sirloin_quinoa_slaw: { foods: ["vinegar"], reason: "A splash of vinegar in the slaw." },
  l_ground_beef_patties_carnivore: { foods: ["salt"], reason: "Salt to season the meat; no calories counted." },
  l_shrimp_rice_broccoli_bowl: { foods: ["garlic"], reason: "A clove of garlic." },
  l_ground_beef_cabbage_bowl_keto: { foods: ["salt", "pepper", "garlic"], reason: "Seasonings; no calories counted." },
  d_salmon_mango_salsa: { foods: ["lime"], reason: "Lime juice for the salsa; a few grams of carbs at most." },
  d_chicken_pineapple_broccoli: { foods: ["teriyaki"], reason: "Sugar-free teriyaki sauce, not a line. It is soy and wheat based, so the soy and wheat or gluten tags come from it (the tags read this text)." },
  d_chuck_roast_mash: { foods: ["broth"], reason: "Beef broth to braise the chuck roast, not counted." },
  d_shrimp_avocado_rice_bowl: { foods: ["lime", "chili"], reason: "Seasonings; no calories counted." },
  d_seitan_black_bean_chili_bowl_vegan: { foods: ["chili"], reason: "Chili spices." },
  s_melon_mint_protein: { foods: ["water"], reason: "Cold water for the shake: no calories." },
  s_jerky_eggs_carnivore: { foods: ["salt"], reason: "Salt to season the meat; no calories counted." },
  s_steak_bites_eggs_carnivore: { foods: ["salt"], reason: "Salt to season the steak; no calories counted." },
  s_tuna_rice_cakes_pescatarian: { foods: ["lemon"], reason: "A squeeze of lemon." },
};

// Words the allergen vocabulary reads as a food but that, in the preparation text, are the cooking verb for bread that IS a line (toasted sourdough). They are satisfied by a
// bread line in the meal, not declared one by one.
export const BREAD_VERB_WORDS = ["toast"];
export const BREAD_LINE_WORDS = ["sourdough", "bread", "bagel"];
