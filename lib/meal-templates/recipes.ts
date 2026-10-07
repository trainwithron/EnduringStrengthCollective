// The 66 recipe templates of Ron's Mix & Macros app, copied as written (and since reworked or added: see docs/NUTRITION_PORT_LOG.md section 7) (docs/old-app/enduring-strength-checkin-engine.html (Mix & Macros), lines 1170-2259). Each build(p, c, f) takes a slot's protein, carb and fat
// grams and returns the meal's lines. The formulas are NOT edited here: the engine calls them through scaleTemplate (scale.ts), which re-aims a formula whose fixed
// sides push the meal off target, and skips a recipe that cannot land (disabled.ts says which and why).
import { FOOD_DENSITY, UNIT_WEIGHT_G } from "./food-table";
import { toOz } from "./render";
import type { TemplateRecipe } from "./types";

// ---- BREAKFAST, LUNCH, DINNER, SNACK ----
export const RECIPES: TemplateRecipe[] = [
  // --- BREAKFAST ---
  {
    id: "b_ny_strip_eggs_cor", name: "NY Strip, Eggs & Fast Cream of Rice + Sourdough", slot: "breakfast", archetypes: ["omnivore", "paleo"], keywords: ["steak", "beef", "egg", "cream of rice"],
    build: (p, c, f) => {
      const eggs = Math.min(3, Math.max(1, Math.floor(f / FOOD_DENSITY.egg_whole_large.fat)));
      const stripG = Math.round(Math.max(0, p - (eggs * FOOD_DENSITY.egg_whole_large.protein)) / FOOD_DENSITY.ny_strip.protein);
      const remFat = Math.max(0, f - (eggs * FOOD_DENSITY.egg_whole_large.fat) - Math.round(stripG * FOOD_DENSITY.ny_strip.fat));
      
      const complexCarbs = c * 0.70;
      const quickCarbs = c * 0.30;
      
      const slices = Math.max(1, Math.round(complexCarbs / FOOD_DENSITY.sourdough_slice.carbs));
      const corG = Math.round(quickCarbs / FOOD_DENSITY.cream_of_rice_dry.carbs);

      return [
        { text: `<strong>Preparation:</strong> Whisk Cream of Rice with water and microwave 2 mins. Sear NY Strip and fry eggs. Serve with toasted sourdough.` },
        { name: "New York Strip Steak", category: "proteins", qty: stripG, unit: "g", text: `<strong>NY Strip (Raw):</strong> ${stripG}g ${toOz(stripG)}` },
        { name: "Whole Eggs", category: "proteins", qty: eggs, unit: "large", text: `<strong>Whole Eggs:</strong> ${eggs} large` },
        { name: "Sourdough Bread", category: "starches", qty: slices, unit: "slices", text: `<strong>Sourdough Bread:</strong> ${slices} slice(s)` },
        { name: "Cream of Rice (Dry)", category: "starches", qty: corG, unit: "g", text: corG > 5 ? `<strong>Cream of Rice:</strong> ${corG}g` : `` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "b_power_oats", name: "High-Protein Oats & Bananas", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["oat", "whey", "milk", "banana"],
    build: (p, c, f) => {
      const milkG = 200;
      const complexCarbs = (c - Math.round(milkG * FOOD_DENSITY.milk_skim.carbs)) * 0.70;
      const quickCarbs = (c - Math.round(milkG * FOOD_DENSITY.milk_skim.carbs)) * 0.30;

      const dryOatsG = Math.round(complexCarbs / FOOD_DENSITY.rolled_oats_dry.carbs);
      const bananaG = Math.round(quickCarbs / FOOD_DENSITY.banana_raw.carbs);

      const remFat = Math.max(0, f - Math.round(dryOatsG * FOOD_DENSITY.rolled_oats_dry.fat));
      const pbG = Math.round(remFat / FOOD_DENSITY.peanut_butter_nat.fat);
      const wheyG = Math.round(Math.max(10, p - 6 - Math.round(dryOatsG * 0.13) - Math.round(pbG * 0.25)) / FOOD_DENSITY.whey_isolate.protein);

      return [
        { text: `<strong>Preparation:</strong> Cook rolled oats in skim milk, stir in whey. Top with sliced fresh banana and peanut butter.` },
        { name: "Skim Milk", category: "dairy", qty: milkG, unit: "g", text: `<strong>Skim Milk:</strong> ${milkG}g` },
        { name: "Rolled Oats (Dry)", category: "starches", qty: dryOatsG, unit: "g", text: `<strong>Rolled Oats:</strong> ${dryOatsG}g` },
        { name: "Banana", category: "produce", qty: bananaG, unit: "g", text: bananaG > 10 ? `<strong>Banana Slices:</strong> ${bananaG}g` : `` },
        { name: "Whey Protein Isolate", category: "proteins", qty: wheyG, unit: "g", text: `<strong>Whey Isolate:</strong> ${wheyG}g` },
        { name: "Natural Peanut Butter", category: "fats", qty: pbG, unit: "g", text: pbG > 2 ? `<strong>Nut Butter:</strong> ${pbG}g` : `` }
      ];
    }
  },
  {
    id: "b_cereal_bowl_eggs", name: "Corn Flakes, Eggs & Toast", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["cereal", "egg", "toast"],
    build: (p, c, f) => {
      const wholeEggs = f >= 10 ? 2 : 1;
      const complexCarbs = c * 0.70;
      const quickCarbs = c * 0.30;

      const slices = Math.max(1, Math.round(complexCarbs / FOOD_DENSITY.sourdough_slice.carbs));
      const cerealG = Math.round(quickCarbs / FOOD_DENSITY.corn_flakes.carbs);

      const remPro = Math.max(0, p - (wholeEggs * 6.3) - (slices * 3.5));
      const wheyG = Math.round(remPro / FOOD_DENSITY.whey_isolate.protein);
      const remFat = Math.max(0, f - (wholeEggs * 5.0));

      return [
        { text: `<strong>Preparation:</strong> Eat a bowl of Corn Flakes with skim milk alongside whole eggs and sourdough toast.` },
        { name: "Whole Eggs", category: "proteins", qty: wholeEggs, unit: "large", text: `<strong>Whole Eggs:</strong> ${wholeEggs} large` },
        { name: "Corn Flakes", category: "starches", qty: cerealG, unit: "g", text: `<strong>Corn Flakes:</strong> ${cerealG}g` },
        { name: "Skim Milk", category: "dairy", qty: 200, unit: "g", text: `<strong>Skim Milk:</strong> 200g` },
        { name: "Sourdough Bread", category: "starches", qty: slices, unit: "slices", text: `<strong>Sourdough Bread:</strong> ${slices} slice(s)` },
        { name: "Whey Protein Isolate", category: "proteins", qty: wheyG, unit: "g", text: `<strong>Whey Isolate (Side Shake):</strong> ${wheyG}g` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "b_scramble_toast_spinach", name: "Pasture Eggs, Spinach & Sourdough Scramble", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["egg", "toast", "sourdough", "spinach"],
    build: (p, c, f) => {
      const wholeEggs = f >= 10 ? 2 : 1;
      const complexCarbs = c * 0.70;
      const quickCarbs = c * 0.30;

      const slices = Math.max(1, Math.round(complexCarbs / FOOD_DENSITY.sourdough_slice.carbs));
      const berryG = Math.round(quickCarbs / FOOD_DENSITY.berries_mixed.carbs);

      const remPro = Math.max(0, p - (wholeEggs * 6.3) - (slices * 3.5));
      const eggWhitesG = Math.round(remPro / FOOD_DENSITY.egg_whites_liquid.protein);
      const remFat = Math.max(0, f - (wholeEggs * 5.0));

      return [
        { text: `<strong>Preparation:</strong> Whisk eggs and cook in a skillet with baby spinach. Serve with toasted sourdough and fresh berries.` },
        { name: "Whole Eggs", category: "proteins", qty: wholeEggs, unit: "large", text: `<strong>Whole Eggs:</strong> ${wholeEggs} large` },
        { name: "Liquid Egg Whites", category: "proteins", qty: eggWhitesG, unit: "g", text: `<strong>Liquid Egg Whites:</strong> ${eggWhitesG}g ${toOz(eggWhitesG)}` },
        { name: "Sourdough Bread", category: "starches", qty: slices, unit: "slices", text: `<strong>Sourdough Bread:</strong> ${slices} slice(s)` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: berryG > 10 ? `<strong>Mixed Berries:</strong> ${berryG}g` : `` },
        { name: "Baby Spinach", category: "produce", qty: 50, unit: "g", text: `<strong>Baby Spinach:</strong> 50g` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "b_peach_cottage_cheese", name: "Peach & Almond Cottage Cheese Bowl", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["cottage cheese", "peach", "almonds", "dairy"],
    build: (p, c, f) => {
      const cheeseG = Math.round(p / FOOD_DENSITY.cottage_cheese_2pct.protein);
      const peachG = Math.round(Math.max(0, c - Math.round(cheeseG * FOOD_DENSITY.cottage_cheese_2pct.carbs)) / FOOD_DENSITY.peach_raw.carbs);
      const almondG = Math.round(Math.max(0, f - Math.round(cheeseG * FOOD_DENSITY.cottage_cheese_2pct.fat)) / FOOD_DENSITY.almonds_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Scoop cottage cheese into a bowl. Dice fresh peaches and scatter on top along with raw almonds.` },
        { name: "2% Cottage Cheese", category: "dairy", qty: cheeseG, unit: "g", text: `<strong>2% Cottage Cheese:</strong> ${cheeseG}g` },
        { name: "Fresh Peaches", category: "produce", qty: peachG, unit: "g", text: peachG > 10 ? `<strong>Fresh Peaches:</strong> ${peachG}g` : `` },
        { name: "Raw Almonds", category: "fats", qty: almondG, unit: "g", text: almondG > 2 ? `<strong>Raw Almonds:</strong> ${almondG}g` : `` }
      ];
    }
  },
  {
    id: "b_cherry_oats", name: "Cherry Vanilla Overnight Oats", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["oat", "whey", "cherry", "milk"],
    build: (p, c, f) => {
      const milkG = 200;
      const cherryG = Math.min(120, Math.round((c * 0.3) / FOOD_DENSITY.cherries_raw.carbs));
      const oatsG = Math.round(Math.max(0, c - Math.round(milkG * FOOD_DENSITY.milk_skim.carbs) - Math.round(cherryG * FOOD_DENSITY.cherries_raw.carbs)) / FOOD_DENSITY.rolled_oats_dry.carbs);
      const wheyG = Math.round(Math.max(0, p - Math.round(milkG * FOOD_DENSITY.milk_skim.protein) - Math.round(oatsG * FOOD_DENSITY.rolled_oats_dry.protein)) / FOOD_DENSITY.whey_isolate.protein);
      const chiaG = Math.round(Math.max(0, f - Math.round(oatsG * FOOD_DENSITY.rolled_oats_dry.fat)) / FOOD_DENSITY.chia_seeds.fat);
      return [
        { text: `<strong>Preparation:</strong> Mix oats, skim milk, vanilla whey, and chia seeds in a jar. Stir in pitted sweet cherries and refrigerate overnight.` },
        { name: "Rolled Oats (Dry)", category: "starches", qty: oatsG, unit: "g", text: `<strong>Rolled Oats (Dry):</strong> ${oatsG}g` },
        { name: "Skim Milk", category: "dairy", qty: milkG, unit: "g", text: `<strong>Skim Milk:</strong> ${milkG}g` },
        { name: "Whey Protein Isolate", category: "proteins", qty: wheyG, unit: "g", text: `<strong>Whey Isolate:</strong> ${wheyG}g` },
        { name: "Sweet Cherries", category: "produce", qty: cherryG, unit: "g", text: `<strong>Sweet Cherries:</strong> ${cherryG}g` },
        { name: "Chia Seeds", category: "fats", qty: chiaG, unit: "g", text: chiaG > 2 ? `<strong>Chia Seeds:</strong> ${chiaG}g` : `` }
      ];
    }
  },
  {
    id: "b_kiwi_raspberry_yogurt", name: "Kiwi & Raspberry Greek Yogurt", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["yogurt", "kiwi", "raspberry", "dairy"],
    build: (p, c, f) => {
      const gyG = Math.round(p / FOOD_DENSITY.greek_yogurt_0pct.protein);
      const kiwiG = Math.round((c * 0.5) / FOOD_DENSITY.kiwi_raw.carbs);
      const raspG = Math.round(Math.max(0, c - Math.round(gyG * FOOD_DENSITY.greek_yogurt_0pct.carbs) - Math.round(kiwiG * FOOD_DENSITY.kiwi_raw.carbs)) / FOOD_DENSITY.raspberries_raw.carbs);
      const walnutG = Math.round(Math.max(0, f - Math.round(gyG * FOOD_DENSITY.greek_yogurt_0pct.fat) - Math.round(kiwiG * FOOD_DENSITY.kiwi_raw.fat)) / FOOD_DENSITY.walnuts_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Scoop yogurt into a bowl. Slice kiwi and scatter over yogurt along with fresh raspberries and crushed walnuts.` },
        { name: "0% Greek Yogurt", category: "dairy", qty: gyG, unit: "g", text: `<strong>0% Greek Yogurt:</strong> ${gyG}g` },
        { name: "Kiwi", category: "produce", qty: kiwiG, unit: "g", text: `<strong>Fresh Kiwi:</strong> ${kiwiG}g` },
        { name: "Raspberries", category: "produce", qty: raspG, unit: "g", text: `<strong>Raspberries:</strong> ${raspG}g` },
        { name: "Raw Walnuts", category: "fats", qty: walnutG, unit: "g", text: walnutG > 2 ? `<strong>Raw Walnuts:</strong> ${walnutG}g` : `` }
      ];
    }
  },
  {
    id: "b_tofu_scramble_berries_vegan", name: "Tofu Scramble & Fresh Berries", slot: "breakfast", archetypes: ["vegan", "vegetarian"], keywords: ["tofu", "berries", "vegan", "scramble"],
    build: (p, c, f) => {
      const tofuG = Math.min(300, Math.round((p * 0.6) / FOOD_DENSITY.tofu_extra_firm.protein));
      const proFromTofu = Math.round(tofuG * FOOD_DENSITY.tofu_extra_firm.protein);
      const powderG = Math.round(Math.max(0, p - proFromTofu) / FOOD_DENSITY.plant_protein.protein);
      const carbsFromTofu = Math.round(tofuG * FOOD_DENSITY.tofu_extra_firm.carbs);
      const berryG = Math.round(Math.max(0, c - carbsFromTofu) / FOOD_DENSITY.berries_mixed.carbs);
      const remFat = Math.max(0, f - Math.round(tofuG * FOOD_DENSITY.tofu_extra_firm.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Crumble and pan-sear pressed tofu with turmeric and nutritional yeast. Serve with fresh mixed berries and sliced avocado.` },
        { name: "Extra Firm Tofu", category: "proteins", qty: tofuG, unit: "g", text: `<strong>Extra Firm Tofu:</strong> ${tofuG}g ${toOz(tofuG)}` },
        { name: "Plant Protein Isolate", category: "proteins", qty: powderG, unit: "g", text: powderG > 5 ? `<strong>Plant Protein (Side Shake):</strong> ${powderG}g` : `` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: berryG > 10 ? `<strong>Fresh Mixed Berries:</strong> ${berryG}g` : `` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },
  {
    id: "b_salmon_toast_pescatarian", name: "Smoked Salmon & Toast", slot: "breakfast", archetypes: ["omnivore", "pescatarian"], keywords: ["salmon", "fish", "toast", "seafood"],
    build: (p, c, f) => {
      const slices = Math.min(3, Math.max(1, Math.floor(c / FOOD_DENSITY.sourdough_slice.carbs)));
      const carbsFromToast = slices * FOOD_DENSITY.sourdough_slice.carbs;
      const proFromToast = slices * FOOD_DENSITY.sourdough_slice.protein;
      const salmonG = Math.round(Math.max(0, p - proFromToast) / FOOD_DENSITY.salmon_raw.protein);
      const remCarbs = Math.max(0, c - carbsFromToast);
      const remFat = Math.max(0, f - Math.round(salmonG * FOOD_DENSITY.salmon_raw.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Pan-sear or use pre-smoked salmon. Toast sourdough and top with mashed avocado and flaked salmon.` },
        { name: "Atlantic Salmon", category: "proteins", qty: salmonG, unit: "g", text: `<strong>Atlantic Salmon:</strong> ${salmonG}g ${toOz(salmonG)}` },
        { name: "Sourdough Bread", category: "starches", qty: slices, unit: "slices", text: `<strong>Sourdough Bread:</strong> ${slices} slice(s)` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado (Mashed):</strong> ${avoG}g` : `` },
        { name: "Strawberries", category: "produce", qty: Math.round(remCarbs / FOOD_DENSITY.strawberries_raw.carbs), unit: "g", text: remCarbs > 5 ? `<strong>Strawberries:</strong> ${Math.round(remCarbs / FOOD_DENSITY.strawberries_raw.carbs)}g` : `` }
      ];
    }
  },

  // NEW RECIPE: Ribeye & Fried Eggs (fills a gap — carnivore/keto had zero
  // dedicated breakfast recipes, so the matcher was falling back to showing
  // lunch/dinner recipes mislabeled as "breakfast" for these two archetypes)
  {
    id: "b_ribeye_eggs_carnivore", name: "Ribeye & Fried Eggs", slot: "breakfast", archetypes: ["carnivore", "keto"], keywords: ["ribeye", "steak", "egg", "beef"],
    build: (p, c, f) => {
      const eggs = Math.min(3, Math.max(1, Math.floor(f / FOOD_DENSITY.egg_whole_large.fat)));
      const steakG = Math.round(Math.max(0, p - (eggs * FOOD_DENSITY.egg_whole_large.protein)) / FOOD_DENSITY.ribeye_steak.protein);
      const remFat = Math.max(0, f - (eggs * FOOD_DENSITY.egg_whole_large.fat) - Math.round(steakG * FOOD_DENSITY.ribeye_steak.fat));
      return [
        { text: `<strong>Preparation:</strong> Sear ribeye in a cast-iron skillet. Fry eggs in the rendered fat. Season with sea salt.` },
        { name: "Ribeye Steak", category: "proteins", qty: steakG, unit: "g", text: `<strong>Ribeye Steak (Raw):</strong> ${steakG}g ${toOz(steakG)}` },
        { name: "Whole Eggs", category: "proteins", qty: eggs, unit: "large", text: `<strong>Whole Eggs:</strong> ${eggs} large` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },

  // --- 4 NEW BREAKFAST RECIPES (built from ingredients already on the grocery list) ---
  {
    id: "b_salmon_eggs_avocado", name: "Salmon, Eggs & Avocado Plate", slot: "breakfast", archetypes: ["omnivore", "pescatarian", "keto", "paleo"], keywords: ["salmon", "egg", "avocado", "fish"],
    build: (p, c, f) => {
      // Reworked for the USDA values: salmon carries about 13 g of fat per 100 g, so the plate keeps the salmon to part of the protein (and of the fat), tops the protein up with
      // egg whites, and adds sourdough toast and berries when the target has carbs to fill. Same foods and same intent: salmon, eggs and avocado.
      const eggs = Math.min(2, Math.max(1, Math.floor((f * 0.35) / FOOD_DENSITY.egg_whole_large.fat)));
      const slices = c > 12 ? Math.min(4, Math.max(0, Math.round((c * 0.7) / FOOD_DENSITY.sourdough_slice.carbs))) : 0;
      const salmonG = Math.round(Math.max(0, Math.min((p * 0.55) / FOOD_DENSITY.salmon_raw.protein, (f * 0.45) / FOOD_DENSITY.salmon_raw.fat)));
      const whitesG = Math.round(Math.max(0, p - (eggs * FOOD_DENSITY.egg_whole_large.protein) - Math.round(salmonG * FOOD_DENSITY.salmon_raw.protein) - (slices * FOOD_DENSITY.sourdough_slice.protein)) / FOOD_DENSITY.egg_whites_liquid.protein);
      const remFat = Math.max(0, f - (eggs * FOOD_DENSITY.egg_whole_large.fat) - Math.round(salmonG * FOOD_DENSITY.salmon_raw.fat) - (slices * FOOD_DENSITY.sourdough_slice.fat));
      // The avocado brings carbs too, so on a low-carb target it is limited and olive oil makes up the rest of the fat.
      const avoG = Math.min(200, Math.round(remFat / FOOD_DENSITY.avocado_hass.fat), Math.round((Math.max(c, 0) * 0.6) / FOOD_DENSITY.avocado_hass.carbs));
      const oilG = Math.max(0, Math.round(remFat - (avoG * FOOD_DENSITY.avocado_hass.fat)));
      const berryG = c <= 14 ? 0 : Math.round(Math.max(0, c - (slices * FOOD_DENSITY.sourdough_slice.carbs) - (eggs * FOOD_DENSITY.egg_whole_large.carbs) - (whitesG * FOOD_DENSITY.egg_whites_liquid.carbs) - (avoG * FOOD_DENSITY.avocado_hass.carbs)) / FOOD_DENSITY.berries_mixed.carbs);
      return [
        { text: `<strong>Preparation:</strong> Pan-sear the salmon fillet. Scramble the whole eggs with the egg whites, toast the sourdough, and serve with sliced avocado and berries.` },
        { name: "Atlantic Salmon", category: "proteins", qty: salmonG, unit: "g", text: `<strong>Atlantic Salmon:</strong> ${salmonG}g ${toOz(salmonG)}` },
        { name: "Whole Eggs", category: "proteins", qty: eggs, unit: "large", text: `<strong>Whole Eggs:</strong> ${eggs} large` },
        { name: "Liquid Egg Whites", category: "proteins", qty: whitesG, unit: "g", text: whitesG > 10 ? `<strong>Liquid Egg Whites:</strong> ${whitesG}g` : `` },
        { name: "Sourdough Bread", category: "starches", qty: slices, unit: "slices", text: slices > 0 ? `<strong>Sourdough Bread:</strong> ${slices} slice(s)` : `` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: berryG > 10 ? `<strong>Mixed Berries:</strong> ${berryG}g` : `` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` },
        { name: "Olive Oil", category: "fats", qty: oilG, unit: "g", text: oilG > 2 ? `<strong>Olive Oil:</strong> ${(oilG/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "b_white_fish_scramble_toast", name: "White Fish, Egg-White Scramble & Sourdough Toast", slot: "breakfast", archetypes: ["pescatarian", "omnivore"], keywords: ["white fish", "cod", "egg whites", "sourdough", "fish", "seafood"],
    build: (p, c, f) => {
      // A lean-fish breakfast for the pescatarian plans (the other two fish breakfasts are fatty salmon): cod, egg whites and sourdough toast, with berries for any remaining
      // carbs and olive oil for the cooking fat. Lean on purpose, so it fits the standard, high-carb, high-protein and light shapes.
      const slices = c > 12 ? Math.min(4, Math.max(0, Math.round((c * 0.7) / FOOD_DENSITY.sourdough_slice.carbs))) : 0;
      const fishG = Math.round(Math.max(0, (p * 0.55) / FOOD_DENSITY.white_fish.protein));
      const whitesG = Math.round(Math.max(0, p - (slices * FOOD_DENSITY.sourdough_slice.protein) - Math.round(fishG * FOOD_DENSITY.white_fish.protein)) / FOOD_DENSITY.egg_whites_liquid.protein);
      const berryG = Math.round(Math.max(0, c - (slices * FOOD_DENSITY.sourdough_slice.carbs) - (whitesG * FOOD_DENSITY.egg_whites_liquid.carbs)) / FOOD_DENSITY.berries_mixed.carbs);
      const remFat = Math.max(0, f - Math.round(fishG * FOOD_DENSITY.white_fish.fat) - (slices * FOOD_DENSITY.sourdough_slice.fat) - Math.round(whitesG * FOOD_DENSITY.egg_whites_liquid.fat));
      return [
        { text: `<strong>Preparation:</strong> Pan-sear the cod in olive oil. Scramble the egg whites, toast the sourdough, and serve with fresh berries.` },
        { name: "White Fish (Cod)", category: "proteins", qty: fishG, unit: "g", text: `<strong>White Fish (Cod, Raw):</strong> ${fishG}g ${toOz(fishG)}` },
        { name: "Liquid Egg Whites", category: "proteins", qty: whitesG, unit: "g", text: whitesG > 10 ? `<strong>Liquid Egg Whites:</strong> ${whitesG}g` : `` },
        { name: "Sourdough Bread", category: "starches", qty: slices, unit: "slices", text: slices > 0 ? `<strong>Sourdough Bread:</strong> ${slices} slice(s)` : `` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: berryG > 10 ? `<strong>Mixed Berries:</strong> ${berryG}g` : `` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "b_chicken_sweet_potato_hash", name: "Chicken & Sweet Potato Breakfast Hash", slot: "breakfast", archetypes: ["omnivore", "paleo"], keywords: ["chicken", "sweet potato", "hash", "egg"],
    build: (p, c, f) => {
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      const chickenG = Math.max(60, Math.round((p - Math.round(spG * FOOD_DENSITY.sweet_potato_raw.protein)) / FOOD_DENSITY.chicken_breast.protein));
      const remFat = Math.max(0, f - Math.round(chickenG * FOOD_DENSITY.chicken_breast.fat));
      return [
        { text: `<strong>Preparation:</strong> Dice sweet potato and pan-fry until golden. Add diced chicken breast and cook through. Season with paprika and pepper.` },
        { name: "Chicken Breast", category: "proteins", qty: chickenG, unit: "g", text: `<strong>Chicken Breast (Raw):</strong> ${chickenG}g ${toOz(chickenG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Diced):</strong> ${spG}g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "b_berry_almond_whey_bowl", name: "Berry Almond Whey Bowl", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["whey", "berries", "almonds", "shake"],
    build: (p, c, f) => {
      const wheyG = Math.max(20, Math.round(p / FOOD_DENSITY.whey_isolate.protein));
      const berryG = Math.round(Math.max(0, c - Math.round(wheyG * FOOD_DENSITY.whey_isolate.carbs)) / FOOD_DENSITY.berries_mixed.carbs);
      const remFat = Math.max(0, f - Math.round(wheyG * FOOD_DENSITY.whey_isolate.fat));
      const almondG = Math.round(remFat / FOOD_DENSITY.almonds_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Blend whey isolate with ice and a splash of water into a thick shake. Top with fresh mixed berries and sliced almonds.` },
        { name: "Whey Protein Isolate", category: "proteins", qty: wheyG, unit: "g", text: `<strong>Whey Isolate:</strong> ${wheyG}g` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: berryG > 10 ? `<strong>Mixed Berries:</strong> ${berryG}g` : `` },
        { name: "Raw Almonds", category: "fats", qty: almondG, unit: "g", text: almondG > 2 ? `<strong>Raw Almonds:</strong> ${almondG}g` : `` }
      ];
    }
  },
  {
    id: "b_sourdough_almond_berry_toast", name: "Sourdough Toast with Almonds & Berries", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["sourdough", "toast", "berries", "almonds"],
    build: (p, c, f) => {
      const slices = Math.max(1, Math.round((c * 0.7) / FOOD_DENSITY.sourdough_slice.carbs));
      const berryG = Math.round(Math.max(0, c - (slices * FOOD_DENSITY.sourdough_slice.carbs)) / FOOD_DENSITY.berries_mixed.carbs);
      const remPro = Math.max(0, p - (slices * FOOD_DENSITY.sourdough_slice.protein));
      const wheyG = Math.round(remPro / FOOD_DENSITY.whey_isolate.protein);
      const remFat = Math.max(0, f - (slices * FOOD_DENSITY.sourdough_slice.fat));
      const almondG = Math.round(remFat / FOOD_DENSITY.almonds_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Toast sourdough. Top with sliced almonds and mixed berries. Pair with a side whey shake to round out protein.` },
        { name: "Sourdough Bread", category: "starches", qty: slices, unit: "slices", text: `<strong>Sourdough Bread:</strong> ${slices} slice(s)` },
        { name: "Whey Protein Isolate", category: "proteins", qty: wheyG, unit: "g", text: wheyG > 5 ? `<strong>Whey Isolate (Side Shake):</strong> ${wheyG}g` : `` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: berryG > 10 ? `<strong>Mixed Berries (Topping):</strong> ${berryG}g` : `` },
        { name: "Raw Almonds", category: "fats", qty: almondG, unit: "g", text: almondG > 2 ? `<strong>Sliced Almonds:</strong> ${almondG}g` : `` }
      ];
    }
  },

  // --- 6 MORE BREAKFAST RECIPES (built from ingredients already on the grocery list, no seafood) ---
  {
    id: "b_turkey_sweet_potato_skillet", name: "Turkey & Sweet Potato Skillet", slot: "breakfast", archetypes: ["omnivore", "paleo"], keywords: ["turkey", "sweet potato", "egg"],
    build: (p, c, f) => {
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      const eggs = Math.min(2, Math.max(1, Math.floor((f * 0.3) / FOOD_DENSITY.egg_whole_large.fat)));
      const turkeyG = Math.max(60, Math.round((p - Math.round(spG * FOOD_DENSITY.sweet_potato_raw.protein) - (eggs * FOOD_DENSITY.egg_whole_large.protein)) / FOOD_DENSITY.turkey_breast.protein));
      const remFat = Math.max(0, f - (eggs * FOOD_DENSITY.egg_whole_large.fat) - Math.round(turkeyG * FOOD_DENSITY.turkey_breast.fat));
      return [
        { text: `<strong>Preparation:</strong> Dice and pan-fry sweet potato until golden. Add diced turkey breast and cook through. Top with a fried egg.` },
        { name: "Turkey Breast", category: "proteins", qty: turkeyG, unit: "g", text: `<strong>Turkey Breast:</strong> ${turkeyG}g ${toOz(turkeyG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Diced):</strong> ${spG}g` },
        { name: "Whole Eggs", category: "proteins", qty: eggs, unit: "large", text: `<strong>Whole Eggs:</strong> ${eggs} large` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "b_chicken_thigh_rice_bowl", name: "Chicken Thigh & Rice Breakfast Bowl", slot: "breakfast", archetypes: ["omnivore"], keywords: ["chicken", "thigh", "rice", "avocado"],
    build: (p, c, f) => {
      const riceG = Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs);
      const chickenG = Math.max(60, Math.round((p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein)) / FOOD_DENSITY.chicken_thigh.protein));
      const remFat = Math.max(0, f - Math.round(chickenG * FOOD_DENSITY.chicken_thigh.fat) - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Cook jasmine rice. Pan-sear seasoned skinless chicken thigh and slice. Serve over rice topped with sliced avocado.` },
        { name: "Chicken Thigh", category: "proteins", qty: chickenG, unit: "g", text: `<strong>Chicken Thigh, Skinless (Raw):</strong> ${chickenG}g ${toOz(chickenG)}` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },
  {
    id: "b_tempeh_oat_bowl_vegan", name: "Tempeh Crumble & Berry Oat Bowl", slot: "breakfast", archetypes: ["vegan", "vegetarian"], keywords: ["tempeh", "oats", "berries", "vegan"],
    build: (p, c, f) => {
      const oatsG = Math.round((c * 0.6) / FOOD_DENSITY.rolled_oats_dry.carbs);
      const berryG = Math.round(Math.max(0, c - Math.round(oatsG * FOOD_DENSITY.rolled_oats_dry.carbs)) / FOOD_DENSITY.berries_mixed.carbs);
      const tempehG = Math.max(40, Math.round(Math.max(0, p - Math.round(oatsG * FOOD_DENSITY.rolled_oats_dry.protein)) / FOOD_DENSITY.tempeh_organic.protein));
      const remFat = Math.max(0, f - Math.round(oatsG * FOOD_DENSITY.rolled_oats_dry.fat) - Math.round(tempehG * FOOD_DENSITY.tempeh_organic.fat));
      return [
        { text: `<strong>Preparation:</strong> Cook rolled oats. Pan-crumble tempeh with cinnamon until lightly browned and stir into the oats. Top with fresh mixed berries.` },
        { name: "Rolled Oats (Dry)", category: "starches", qty: oatsG, unit: "g", text: `<strong>Rolled Oats (Dry):</strong> ${oatsG}g` },
        { name: "Organic Tempeh", category: "proteins", qty: tempehG, unit: "g", text: `<strong>Tempeh (Crumbled):</strong> ${tempehG}g ${toOz(tempehG)}` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: berryG > 10 ? `<strong>Mixed Berries:</strong> ${berryG}g` : `` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "b_cottage_cheese_walnut_berry_bowl", name: "Cottage Cheese, Walnuts & Berries", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["cottage cheese", "walnuts", "berries"],
    build: (p, c, f) => {
      const cheeseG = Math.max(100, Math.min(350, Math.round(p / FOOD_DENSITY.cottage_cheese_2pct.protein)));
      const berryG = Math.round(Math.max(0, c - Math.round(cheeseG * FOOD_DENSITY.cottage_cheese_2pct.carbs)) / FOOD_DENSITY.berries_mixed.carbs);
      const remFat = Math.max(0, f - Math.round(cheeseG * FOOD_DENSITY.cottage_cheese_2pct.fat));
      const walnutG = Math.round(remFat / FOOD_DENSITY.walnuts_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Ready-to-eat. Top cottage cheese with fresh mixed berries and chopped walnuts.` },
        { name: "2% Cottage Cheese", category: "proteins", qty: cheeseG, unit: "g", text: `<strong>2% Cottage Cheese:</strong> ${cheeseG}g` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: berryG > 10 ? `<strong>Mixed Berries:</strong> ${berryG}g` : `` },
        { name: "Raw Walnuts", category: "fats", qty: walnutG, unit: "g", text: walnutG > 2 ? `<strong>Chopped Walnuts:</strong> ${walnutG}g` : `` }
      ];
    }
  },
  {
    id: "b_egg_white_black_bean_wrap", name: "Egg White & Black Bean Breakfast Wrap", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["egg whites", "black beans", "wrap"],
    build: (p, c, f) => {
      const wraps = Math.max(1, Math.floor((c * 0.5) / FOOD_DENSITY.whole_wheat_wrap.carbs));
      const beanG = Math.round(Math.max(0, c - (wraps * FOOD_DENSITY.whole_wheat_wrap.carbs)) / FOOD_DENSITY.black_beans_cooked.carbs);
      const remPro = Math.max(0, p - (wraps * FOOD_DENSITY.whole_wheat_wrap.protein) - Math.round(beanG * FOOD_DENSITY.black_beans_cooked.protein));
      const eggWhitesG = Math.round(remPro / FOOD_DENSITY.egg_whites_liquid.protein);
      const remFat = Math.max(0, f - (wraps * FOOD_DENSITY.whole_wheat_wrap.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Scramble liquid egg whites. Warm black beans. Fill the wrap with egg whites, beans, and mashed avocado.` },
        { name: "Liquid Egg Whites", category: "proteins", qty: eggWhitesG, unit: "g", text: `<strong>Liquid Egg Whites:</strong> ${eggWhitesG}g ${toOz(eggWhitesG)}` },
        { name: "Black Beans (Cooked)", category: "starches", qty: beanG, unit: "g", text: `<strong>Black Beans (Cooked):</strong> ${beanG}g` },
        { name: "Whole Wheat Wrap", category: "starches", qty: wraps, unit: "wraps", text: `<strong>Whole Wheat Wrap:</strong> ${wraps} wrap(s)` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },
  {
    id: "b_casein_overnight_pudding", name: "Casein Overnight Pudding", slot: "breakfast", archetypes: ["omnivore", "vegetarian"], keywords: ["casein", "oats", "berries", "overnight"],
    build: (p, c, f) => {
      const caseinG = Math.max(20, Math.round(p / FOOD_DENSITY.casein_protein.protein));
      const oatsG = Math.round(Math.max(0, c - Math.round(caseinG * FOOD_DENSITY.casein_protein.carbs)) * 0.6 / FOOD_DENSITY.rolled_oats_dry.carbs);
      const berryG = Math.round(Math.max(0, c - Math.round(caseinG * FOOD_DENSITY.casein_protein.carbs) - Math.round(oatsG * FOOD_DENSITY.rolled_oats_dry.carbs)) / FOOD_DENSITY.berries_mixed.carbs);
      const remFat = Math.max(0, f - Math.round(caseinG * FOOD_DENSITY.casein_protein.fat) - Math.round(oatsG * FOOD_DENSITY.rolled_oats_dry.fat));
      const almondG = Math.round(remFat / FOOD_DENSITY.almonds_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Whisk casein protein with water or milk into a thick pudding. Stir in oats and refrigerate overnight. Top with berries and almonds before eating.` },
        { name: "Casein Protein", category: "proteins", qty: caseinG, unit: "g", text: `<strong>Casein Protein:</strong> ${caseinG}g` },
        { name: "Rolled Oats (Dry)", category: "starches", qty: oatsG, unit: "g", text: `<strong>Rolled Oats (Dry):</strong> ${oatsG}g` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: berryG > 10 ? `<strong>Mixed Berries:</strong> ${berryG}g` : `` },
        { name: "Raw Almonds", category: "fats", qty: almondG, unit: "g", text: almondG > 2 ? `<strong>Raw Almonds:</strong> ${almondG}g` : `` }
      ];
    }
  },

  // --- LUNCH ---
  {
    id: "l_chicken_rice_broccoli", name: "Lean Chicken, Rice & Roasted Broccoli", slot: "lunch", archetypes: ["omnivore"], keywords: ["chicken", "rice", "broccoli"],
    build: (p, c, f) => {
      const riceG = Math.min(150, Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs));
      const chickenG = Math.max(60, Math.round((p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein)) / FOOD_DENSITY.chicken_breast.protein));
      const remFat = Math.max(0, f - Math.round(chickenG * FOOD_DENSITY.chicken_breast.fat));
      return [
        { text: `<strong>Preparation:</strong> Cook rice. Bake seasoned chicken breast and broccoli florets at 400°F until tender. Drizzle with olive oil.` },
        { name: "Chicken Breast", category: "proteins", qty: chickenG, unit: "g", text: `<strong>Chicken Breast (Raw):</strong> ${chickenG}g ${toOz(chickenG)}` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 150, unit: "g", text: `<strong>Broccoli Florets:</strong> 150g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` }
      ];
    }
  },
  {
    id: "l_sirloin_quinoa_slaw", name: "Top Sirloin, Quinoa & Cabbage Slaw", slot: "lunch", archetypes: ["omnivore", "paleo"], keywords: ["steak", "sirloin", "quinoa", "cabbage"],
    build: (p, c, f) => {
      const quinoaG = Math.round(c / FOOD_DENSITY.quinoa_dry.carbs);
      const sirloinG = Math.max(60, Math.round((p - Math.round(quinoaG * FOOD_DENSITY.quinoa_dry.protein)) / FOOD_DENSITY.sirloin_steak.protein));
      const remFat = Math.max(0, f - Math.round(sirloinG * FOOD_DENSITY.sirloin_steak.fat) - Math.round(quinoaG * FOOD_DENSITY.quinoa_dry.fat));
      return [
        { text: `<strong>Preparation:</strong> Boil quinoa. Grill sirloin steak and slice thin. Toss shredded green cabbage and carrots with olive oil and vinegar.` },
        { name: "Top Sirloin Steak", category: "proteins", qty: sirloinG, unit: "g", text: `<strong>Top Sirloin (Raw):</strong> ${sirloinG}g ${toOz(sirloinG)}` },
        { name: "Dry Quinoa", category: "starches", qty: quinoaG, unit: "g", text: `<strong>Quinoa (Dry):</strong> ${quinoaG}g` },
        { name: "Green Cabbage", category: "produce", qty: 100, unit: "g", text: `<strong>Green Cabbage (Shredded):</strong> 100g` },
        { name: "Carrots", category: "produce", qty: 50, unit: "g", text: `<strong>Carrots (Shredded):</strong> 50g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_pork_tenderloin_peppers", name: "Pork Tenderloin & Bell Pepper Stir-Fry", slot: "lunch", archetypes: ["omnivore", "paleo"], keywords: ["pork", "peppers", "zucchini"],
    build: (p, c, f) => {
      const potG = Math.round(c / FOOD_DENSITY.potato_russet_raw.carbs);
      const porkG = Math.max(60, Math.round((p - Math.round(potG * FOOD_DENSITY.potato_russet_raw.protein)) / FOOD_DENSITY.pork_tenderloin.protein));
      const remFat = Math.max(0, f - Math.round(porkG * FOOD_DENSITY.pork_tenderloin.fat));
      return [
        { text: `<strong>Preparation:</strong> Sauté sliced pork tenderloin, bell peppers, and zucchini in a hot pan. Serve over boiled or roasted russet potatoes.` },
        { name: "Pork Tenderloin", category: "proteins", qty: porkG, unit: "g", text: `<strong>Pork Tenderloin (Raw):</strong> ${porkG}g ${toOz(porkG)}` },
        { name: "Russet Potatoes", category: "starches", qty: potG, unit: "g", text: `<strong>Russet Potatoes (Raw):</strong> ${potG}g` },
        { name: "Bell Pepper", category: "produce", qty: 120, unit: "g", text: `<strong>Bell Peppers (Sliced):</strong> 120g` },
        { name: "Zucchini", category: "produce", qty: 100, unit: "g", text: `<strong>Zucchini:</strong> 100g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_beef_black_bean_wrap", name: "Beef & Black Bean Burrito", slot: "lunch", archetypes: ["omnivore"], keywords: ["beef", "beans", "wrap", "burrito"],
    build: (p, c, f) => {
      const wraps = Math.max(1, Math.floor((c * 0.4) / FOOD_DENSITY.whole_wheat_wrap.carbs));
      const beanG = Math.round(Math.max(0, c - (wraps * FOOD_DENSITY.whole_wheat_wrap.carbs)) / FOOD_DENSITY.black_beans_cooked.carbs);
      const beefG = Math.round(Math.max(0, p - Math.round(beanG * FOOD_DENSITY.black_beans_cooked.protein) - (wraps * FOOD_DENSITY.whole_wheat_wrap.protein)) / FOOD_DENSITY.ground_beef_93_7.protein);
      const remFat = Math.max(0, f - Math.round(beefG * FOOD_DENSITY.ground_beef_93_7.fat) - (wraps * FOOD_DENSITY.whole_wheat_wrap.fat));
      return [
        { text: `<strong>Preparation:</strong> Brown 93/7 beef in a skillet. Warm black beans. Load both into the whole wheat wrap with sliced avocado.` },
        { name: "93/7 Ground Beef", category: "proteins", qty: beefG, unit: "g", text: `<strong>93/7 Ground Beef:</strong> ${beefG}g ${toOz(beefG)}` },
        { name: "Black Beans (Cooked)", category: "starches", qty: beanG, unit: "g", text: `<strong>Black Beans (Cooked):</strong> ${beanG}g` },
        { name: "Whole Wheat Wrap", category: "starches", qty: wraps, unit: "wraps", text: `<strong>Whole Wheat Wrap:</strong> ${wraps} wrap(s)` },
        { name: "Hass Avocado", category: "fats", qty: Math.round(remFat/0.15), unit: "g", text: remFat > 2 ? `<strong>Hass Avocado:</strong> ${Math.round(remFat/0.15)}g` : `` }
      ];
    }
  },
  {
    id: "l_citrus_shrimp_quinoa", name: "Citrus Shrimp & Quinoa Salad", slot: "lunch", archetypes: ["omnivore", "pescatarian"], keywords: ["shrimp", "quinoa", "grapefruit", "seafood"],
    build: (p, c, f) => {
      const quinoaG = Math.min(100, Math.round((c * 0.6) / FOOD_DENSITY.quinoa_dry.carbs));
      const shrimpG = Math.round(Math.max(0, p - Math.round(quinoaG * FOOD_DENSITY.quinoa_dry.protein)) / FOOD_DENSITY.shrimp_raw.protein);
      const grapeG = Math.round(Math.max(0, c - Math.round(quinoaG * FOOD_DENSITY.quinoa_dry.carbs)) / FOOD_DENSITY.grapefruit_raw.carbs);
      const remFat = Math.max(0, f - Math.round(quinoaG * FOOD_DENSITY.quinoa_dry.fat));
      return [
        { text: `<strong>Preparation:</strong> Boil quinoa and let cool. Sauté shrimp in a pan. Segment grapefruit and toss everything with chopped asparagus and olive oil.` },
        { name: "Raw Shrimp", category: "proteins", qty: shrimpG, unit: "g", text: `<strong>Raw Shrimp:</strong> ${shrimpG}g ${toOz(shrimpG)}` },
        { name: "Dry Quinoa", category: "starches", qty: quinoaG, unit: "g", text: `<strong>Quinoa (Dry):</strong> ${quinoaG}g` },
        { name: "Grapefruit", category: "produce", qty: grapeG, unit: "g", text: `<strong>Grapefruit:</strong> ${grapeG}g` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_pork_pear_skillet", name: "Pork Tenderloin & Pear Skillet", slot: "lunch", archetypes: ["omnivore", "paleo"], keywords: ["pork", "pear", "sweet potato"],
    build: (p, c, f) => {
      const porkG = Math.round(p / FOOD_DENSITY.pork_tenderloin.protein);
      const pearG = Math.min(150, Math.round((c * 0.4) / FOOD_DENSITY.pear_raw.carbs));
      const spG = Math.round(Math.max(0, c - Math.round(pearG * FOOD_DENSITY.pear_raw.carbs)) / FOOD_DENSITY.sweet_potato_raw.carbs);
      const remFat = Math.max(0, f - Math.round(porkG * FOOD_DENSITY.pork_tenderloin.fat));
      return [
        { text: `<strong>Preparation:</strong> Cube sweet potatoes and roast. Sauté sliced pork tenderloin and fresh pears in a skillet until golden.` },
        { name: "Pork Tenderloin", category: "proteins", qty: porkG, unit: "g", text: `<strong>Pork Tenderloin (Raw):</strong> ${porkG}g ${toOz(porkG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Raw):</strong> ${spG}g` },
        { name: "Pears", category: "produce", qty: pearG, unit: "g", text: `<strong>Sliced Pears:</strong> ${pearG}g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_turkey_apple_salad", name: "Turkey Breast & Apple Spinach Wrap", slot: "lunch", archetypes: ["omnivore"], keywords: ["turkey", "wrap", "apple"],
    build: (p, c, f) => {
      const wraps = Math.max(1, Math.floor((c * 0.5) / FOOD_DENSITY.whole_wheat_wrap.carbs));
      const turkeyG = Math.round(Math.max(0, p - (wraps * FOOD_DENSITY.whole_wheat_wrap.protein)) / FOOD_DENSITY.turkey_breast.protein);
      const appleG = Math.round(Math.max(0, c - (wraps * FOOD_DENSITY.whole_wheat_wrap.carbs)) / FOOD_DENSITY.apple_raw.carbs);
      const remFat = Math.max(0, f - (wraps * FOOD_DENSITY.whole_wheat_wrap.fat) - Math.round(turkeyG * FOOD_DENSITY.turkey_breast.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Layer sliced turkey breast, thinly sliced apples, spinach, and mashed avocado inside the wrap.` },
        { name: "Turkey Breast", category: "proteins", qty: turkeyG, unit: "g", text: `<strong>Turkey Breast:</strong> ${turkeyG}g ${toOz(turkeyG)}` },
        { name: "Whole Wheat Wrap", category: "starches", qty: wraps, unit: "wraps", text: `<strong>Whole Wheat Wrap:</strong> ${wraps} wrap(s)` },
        { name: "Apples", category: "produce", qty: appleG, unit: "g", text: `<strong>Fresh Apple:</strong> ${appleG}g` },
        { name: "Baby Spinach", category: "produce", qty: 50, unit: "g", text: `<strong>Baby Spinach:</strong> 50g` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado (Spread):</strong> ${avoG}g` : `` }
      ];
    }
  },
  {
    id: "l_ground_beef_patties_carnivore", name: "80/20 Ground Beef Patties", slot: "lunch", archetypes: ["carnivore", "keto"], keywords: ["beef", "ground beef", "patties"],
    build: (p, c, f) => {
      const beefG = Math.round(p / FOOD_DENSITY.ground_beef_80_20.protein);
      const remFat = Math.max(0, f - Math.round(beefG * FOOD_DENSITY.ground_beef_80_20.fat));
      return [
        { text: `<strong>Preparation:</strong> Form ground beef into patties and pan-sear. Season generously with coarse sea salt.` },
        { name: "80/20 Ground Beef", category: "proteins", qty: beefG, unit: "g", text: `<strong>80/20 Ground Beef (Raw):</strong> ${beefG}g ${toOz(beefG)}` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter (For Basting):</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_tempeh_black_bean_bowl_vegan", name: "Tempeh & Black Bean Rice Bowl", slot: "lunch", archetypes: ["vegan", "vegetarian"], keywords: ["tempeh", "beans", "rice", "vegan"],
    build: (p, c, f) => {
      const riceG = Math.min(120, Math.round((c * 0.5) / FOOD_DENSITY.jasmine_rice_dry.carbs));
      const beanG = Math.round(Math.max(0, c - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.carbs)) / FOOD_DENSITY.black_beans_cooked.carbs);
      const proFromRiceAndBeans = Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein) + Math.round(beanG * FOOD_DENSITY.black_beans_cooked.protein);
      const tempehG = Math.round(Math.max(0, p - proFromRiceAndBeans) / FOOD_DENSITY.tempeh_organic.protein);
      const remFat = Math.max(0, f - Math.round(tempehG * FOOD_DENSITY.tempeh_organic.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Pan-sear cubed tempeh until golden. Warm black beans. Serve over rice with sliced avocado.` },
        { name: "Organic Tempeh", category: "proteins", qty: tempehG, unit: "g", text: `<strong>Organic Tempeh:</strong> ${tempehG}g ${toOz(tempehG)}` },
        { name: "Black Beans (Cooked)", category: "starches", qty: beanG, unit: "g", text: `<strong>Black Beans (Cooked):</strong> ${beanG}g` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },

  // --- 3 NEW LUNCH RECIPES (built from ingredients already on the grocery list) ---
  {
    id: "l_shrimp_rice_broccoli_bowl", name: "Shrimp, Rice & Broccoli Bowl", slot: "lunch", archetypes: ["omnivore", "pescatarian"], keywords: ["shrimp", "rice", "broccoli", "seafood"],
    build: (p, c, f) => {
      const riceG = Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs);
      const shrimpG = Math.max(60, Math.round((p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein)) / FOOD_DENSITY.shrimp_raw.protein));
      const remFat = Math.max(0, f - Math.round(shrimpG * FOOD_DENSITY.shrimp_raw.fat) - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.fat));
      return [
        { text: `<strong>Preparation:</strong> Cook jasmine rice. Sauté shrimp with garlic. Steam broccoli florets. Combine in a bowl and drizzle with olive oil.` },
        { name: "Raw Shrimp", category: "proteins", qty: shrimpG, unit: "g", text: `<strong>Raw Shrimp:</strong> ${shrimpG}g ${toOz(shrimpG)}` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 150, unit: "g", text: `<strong>Broccoli Florets:</strong> 150g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_chicken_sweet_potato_asparagus", name: "Chicken, Sweet Potato & Asparagus Plate", slot: "lunch", archetypes: ["omnivore", "paleo"], keywords: ["chicken", "sweet potato", "asparagus"],
    build: (p, c, f) => {
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      const chickenG = Math.max(60, Math.round((p - Math.round(spG * FOOD_DENSITY.sweet_potato_raw.protein)) / FOOD_DENSITY.chicken_breast.protein));
      const remFat = Math.max(0, f - Math.round(chickenG * FOOD_DENSITY.chicken_breast.fat));
      return [
        { text: `<strong>Preparation:</strong> Roast cubed sweet potato and asparagus at 400°F. Grill or bake seasoned chicken breast until cooked through.` },
        { name: "Chicken Breast", category: "proteins", qty: chickenG, unit: "g", text: `<strong>Chicken Breast (Raw):</strong> ${chickenG}g ${toOz(chickenG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Raw):</strong> ${spG}g` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_salmon_potato_avocado_bowl", name: "Salmon, Potato & Avocado Bowl", slot: "lunch", archetypes: ["omnivore", "pescatarian", "paleo"], keywords: ["salmon", "potato", "avocado", "fish"],
    build: (p, c, f) => {
      const potG = Math.round(c / FOOD_DENSITY.potato_russet_raw.carbs);
      const salmonG = Math.max(60, Math.round((p - Math.round(potG * FOOD_DENSITY.potato_russet_raw.protein)) / FOOD_DENSITY.salmon_raw.protein));
      const remFat = Math.max(0, f - Math.round(salmonG * FOOD_DENSITY.salmon_raw.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Roast diced russet potatoes until crisp. Pan-sear salmon. Combine in a bowl with sliced avocado and steamed asparagus.` },
        { name: "Atlantic Salmon", category: "proteins", qty: salmonG, unit: "g", text: `<strong>Atlantic Salmon:</strong> ${salmonG}g ${toOz(salmonG)}` },
        { name: "Russet Potatoes", category: "starches", qty: potG, unit: "g", text: `<strong>Russet Potatoes (Raw):</strong> ${potG}g` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },

  // --- 7 MORE LUNCH RECIPES (built from ingredients already on the grocery list, no seafood) ---
  {
    id: "l_turkey_quinoa_broccoli_bowl", name: "Turkey & Quinoa Power Bowl", slot: "lunch", archetypes: ["omnivore"], keywords: ["turkey", "quinoa", "broccoli"],
    build: (p, c, f) => {
      const quinoaG = Math.round(c / FOOD_DENSITY.quinoa_dry.carbs);
      const turkeyG = Math.max(60, Math.round((p - Math.round(quinoaG * FOOD_DENSITY.quinoa_dry.protein)) / FOOD_DENSITY.turkey_breast.protein));
      const remFat = Math.max(0, f - Math.round(turkeyG * FOOD_DENSITY.turkey_breast.fat) - Math.round(quinoaG * FOOD_DENSITY.quinoa_dry.fat));
      return [
        { text: `<strong>Preparation:</strong> Cook quinoa. Grill or pan-sear turkey breast and slice. Steam broccoli. Combine in a bowl with olive oil.` },
        { name: "Turkey Breast", category: "proteins", qty: turkeyG, unit: "g", text: `<strong>Turkey Breast:</strong> ${turkeyG}g ${toOz(turkeyG)}` },
        { name: "Dry Quinoa", category: "starches", qty: quinoaG, unit: "g", text: `<strong>Quinoa (Dry):</strong> ${quinoaG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 150, unit: "g", text: `<strong>Broccoli Florets:</strong> 150g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_chuck_roast_sweet_potato_bowl", name: "Chuck Roast & Sweet Potato Bowl", slot: "lunch", archetypes: ["omnivore", "paleo"], keywords: ["chuck roast", "beef", "sweet potato"],
    build: (p, c, f) => {
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      const beefG = Math.max(60, Math.round((p - Math.round(spG * FOOD_DENSITY.sweet_potato_raw.protein)) / FOOD_DENSITY.chuck_roast_trimmed.protein));
      const remFat = Math.max(0, f - Math.round(beefG * FOOD_DENSITY.chuck_roast_trimmed.fat));
      return [
        { text: `<strong>Preparation:</strong> Trim the visible fat from the chuck roast, slow-cook it and shred it. Roast cubed sweet potato and asparagus. Combine in a bowl.` },
        { name: "Chuck Roast, Trimmed", category: "proteins", qty: beefG, unit: "g", text: `<strong>Trimmed Chuck Roast (Raw):</strong> ${beefG}g ${toOz(beefG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Raw):</strong> ${spG}g` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_ny_strip_sweet_potato_plate", name: "NY Strip & Sweet Potato Plate", slot: "lunch", archetypes: ["omnivore", "paleo", "keto"], keywords: ["ny strip", "steak", "sweet potato"],
    build: (p, c, f) => {
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      const steakG = Math.max(60, Math.round((p - Math.round(spG * FOOD_DENSITY.sweet_potato_raw.protein)) / FOOD_DENSITY.ny_strip.protein));
      const remFat = Math.max(0, f - Math.round(steakG * FOOD_DENSITY.ny_strip.fat));
      return [
        { text: `<strong>Preparation:</strong> Sear NY Strip to desired doneness. Roast cubed sweet potato and asparagus alongside.` },
        { name: "New York Strip Steak", category: "proteins", qty: steakG, unit: "g", text: `<strong>NY Strip (Raw):</strong> ${steakG}g ${toOz(steakG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Raw):</strong> ${spG}g` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_tempeh_quinoa_buddha_bowl_vegan", name: "Tempeh & Quinoa Buddha Bowl", slot: "lunch", archetypes: ["vegan", "vegetarian"], keywords: ["tempeh", "quinoa", "broccoli", "vegan"],
    build: (p, c, f) => {
      const quinoaG = Math.round((c * 0.6) / FOOD_DENSITY.quinoa_dry.carbs);
      const tempehG = Math.max(60, Math.round(Math.max(0, p - Math.round(quinoaG * FOOD_DENSITY.quinoa_dry.protein)) / FOOD_DENSITY.tempeh_organic.protein));
      const remFat = Math.max(0, f - Math.round(quinoaG * FOOD_DENSITY.quinoa_dry.fat) - Math.round(tempehG * FOOD_DENSITY.tempeh_organic.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Cook quinoa. Pan-sear cubed tempeh until crisp. Steam broccoli. Assemble the bowl and top with sliced avocado.` },
        { name: "Organic Tempeh", category: "proteins", qty: tempehG, unit: "g", text: `<strong>Tempeh (Cubed):</strong> ${tempehG}g ${toOz(tempehG)}` },
        { name: "Dry Quinoa", category: "starches", qty: quinoaG, unit: "g", text: `<strong>Quinoa (Dry):</strong> ${quinoaG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 150, unit: "g", text: `<strong>Broccoli Florets:</strong> 150g` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },
  {
    id: "l_seitan_black_bean_burrito_bowl_vegan", name: "Black Bean & Seitan Burrito Bowl", slot: "lunch", archetypes: ["vegan", "vegetarian"], keywords: ["seitan", "black beans", "rice", "vegan"],
    build: (p, c, f) => {
      const riceG = Math.round((c * 0.6) / FOOD_DENSITY.jasmine_rice_dry.carbs);
      const beanG = Math.round(Math.max(0, c - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.carbs)) / FOOD_DENSITY.black_beans_cooked.carbs);
      const seitanG = Math.max(60, Math.round(Math.max(0, p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein) - Math.round(beanG * FOOD_DENSITY.black_beans_cooked.protein)) / FOOD_DENSITY.seitan.protein));
      const remFat = Math.max(0, f - Math.round(seitanG * FOOD_DENSITY.seitan.fat) - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Cook rice. Warm black beans. Pan-sear sliced seitan. Layer into a bowl and top with sliced avocado.` },
        { name: "Seitan", category: "proteins", qty: seitanG, unit: "g", text: `<strong>Seitan (Sliced):</strong> ${seitanG}g ${toOz(seitanG)}` },
        { name: "Black Beans (Cooked)", category: "starches", qty: beanG, unit: "g", text: `<strong>Black Beans (Cooked):</strong> ${beanG}g` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },
  {
    id: "l_chicken_thigh_broccoli_rice_bowl", name: "Chicken Thigh, Broccoli & Rice Bowl", slot: "lunch", archetypes: ["omnivore"], keywords: ["chicken", "thigh", "broccoli", "rice"],
    build: (p, c, f) => {
      const riceG = Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs);
      const chickenG = Math.max(60, Math.round((p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein)) / FOOD_DENSITY.chicken_thigh.protein));
      const remFat = Math.max(0, f - Math.round(chickenG * FOOD_DENSITY.chicken_thigh.fat) - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.fat));
      return [
        { text: `<strong>Preparation:</strong> Cook jasmine rice. Pan-sear seasoned skinless chicken thigh and slice. Steam broccoli florets. Combine in a bowl and drizzle with olive oil.` },
        { name: "Chicken Thigh", category: "proteins", qty: chickenG, unit: "g", text: `<strong>Chicken Thigh, Skinless (Raw):</strong> ${chickenG}g ${toOz(chickenG)}` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 150, unit: "g", text: `<strong>Broccoli Florets:</strong> 150g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "l_ground_beef_cabbage_bowl_keto", name: "80/20 Beef & Cabbage Bowl", slot: "lunch", archetypes: ["omnivore", "keto"], keywords: ["beef", "ground beef", "cabbage", "keto"],
    build: (p, c, f) => {
      const beefG = Math.max(60, Math.round(p / FOOD_DENSITY.ground_beef_80_20.protein));
      const remFat = Math.max(0, f - Math.round(beefG * FOOD_DENSITY.ground_beef_80_20.fat));
      return [
        { text: `<strong>Preparation:</strong> Brown 80/20 ground beef in a skillet. Add shredded green cabbage and sauté until tender. Season with salt, pepper, and garlic.` },
        { name: "80/20 Ground Beef", category: "proteins", qty: beefG, unit: "g", text: `<strong>80/20 Ground Beef:</strong> ${beefG}g ${toOz(beefG)}` },
        { name: "Green Cabbage", category: "produce", qty: 150, unit: "g", text: `<strong>Green Cabbage (Shredded):</strong> 150g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },

  // --- DINNER ---
  {
    id: "d_ribeye_potatoes", name: "Cast Iron Ribeye & Russet Potatoes", slot: "dinner", archetypes: ["omnivore", "keto", "paleo"], keywords: ["ribeye", "steak", "potato"],
    build: (p, c, f) => {
      const steakG = Math.round(p / FOOD_DENSITY.ribeye_steak.protein);
      const potG = Math.round(c / FOOD_DENSITY.potato_russet_raw.carbs);
      const remFat = Math.max(0, f - Math.round(steakG * FOOD_DENSITY.ribeye_steak.fat));
      return [
        { text: `<strong>Preparation:</strong> Sear ribeye in a screaming hot cast-iron skillet. Bake russet potatoes in the oven. Top steak with grass-fed butter.` },
        { name: "Ribeye Steak", category: "proteins", qty: steakG, unit: "g", text: `<strong>Ribeye Steak (Raw):</strong> ${steakG}g ${toOz(steakG)}` },
        { name: "Russet Potatoes", category: "starches", qty: potG, unit: "g", text: potG > 10 ? `<strong>Russet Potatoes (Raw):</strong> ${potG}g` : `` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus Spears:</strong> 100g` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_salmon_mango_salsa", name: "Tropical Salmon & Mango Salsa Bowl", slot: "dinner", archetypes: ["omnivore", "pescatarian"], keywords: ["salmon", "mango", "rice", "seafood"],
    build: (p, c, f) => {
      const salmonG = Math.min(220, Math.max(100, Math.round(f / FOOD_DENSITY.salmon_raw.fat)));
      const remPro = Math.max(0, p - Math.round(salmonG * FOOD_DENSITY.salmon_raw.protein));
      const shrimpG = Math.round(remPro / FOOD_DENSITY.shrimp_raw.protein);
      const mangoG = Math.min(150, Math.round((c * 0.3) / FOOD_DENSITY.mango_raw.carbs));
      const riceG = Math.round(Math.max(0, c - Math.round(mangoG * FOOD_DENSITY.mango_raw.carbs)) / FOOD_DENSITY.jasmine_rice_dry.carbs);
      
      const items = [
        { text: `<strong>Preparation:</strong> Bake salmon at 400°F. Dice mango and mix with red onions and lime juice for salsa. Serve salmon over rice topped with salsa.` },
        { name: "Atlantic Salmon", category: "proteins", qty: salmonG, unit: "g", text: `<strong>Atlantic Salmon (Raw):</strong> ${salmonG}g ${toOz(salmonG)}` }
      ];
      if (shrimpG > 5) items.push({ name: "Raw Shrimp", category: "proteins", qty: shrimpG, unit: "g", text: `<strong>Raw Shrimp Booster:</strong> ${shrimpG}g` });
      items.push({ name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` });
      items.push({ name: "Mangoes", category: "produce", qty: mangoG, unit: "g", text: `<strong>Diced Mango:</strong> ${mangoG}g` });
      items.push({ name: "Zucchini", category: "produce", qty: 100, unit: "g", text: `<strong>Zucchini (Side):</strong> 100g` });
      return items;
    }
  },
  {
    id: "d_chicken_pineapple_broccoli", name: "Pineapple Chicken Teriyaki", slot: "dinner", archetypes: ["omnivore"], keywords: ["chicken", "pineapple", "broccoli", "rice"],
    build: (p, c, f) => {
      const pineG = Math.min(150, Math.round((c * 0.3) / FOOD_DENSITY.pineapple_raw.carbs));
      const riceG = Math.round(Math.max(0, c - Math.round(pineG * FOOD_DENSITY.pineapple_raw.carbs)) / FOOD_DENSITY.jasmine_rice_dry.carbs);
      const chickenG = Math.max(60, Math.round((p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein)) / FOOD_DENSITY.chicken_breast.protein));
      const remFat = Math.max(0, f - Math.round(chickenG * FOOD_DENSITY.chicken_breast.fat));
      return [
        { text: `<strong>Preparation:</strong> Sauté cubed chicken breast. Add broccoli florets and diced pineapple. Toss in sugar-free teriyaki sauce and serve over rice.` },
        { name: "Chicken Breast", category: "proteins", qty: chickenG, unit: "g", text: `<strong>Chicken Breast (Raw):</strong> ${chickenG}g ${toOz(chickenG)}` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Pineapple", category: "produce", qty: pineG, unit: "g", text: `<strong>Fresh Pineapple:</strong> ${pineG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 150, unit: "g", text: `<strong>Broccoli Florets:</strong> 150g` },
        { name: "Sesame Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Sesame Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_steak_plum_salad", name: "Flank Steak & Plum Spinach Salad", slot: "dinner", archetypes: ["omnivore", "paleo"], keywords: ["steak", "flank", "plum", "salad"],
    build: (p, c, f) => {
      const steakG = Math.round(p / FOOD_DENSITY.flank_steak.protein);
      const plumG = Math.min(200, Math.round((c * 0.5) / FOOD_DENSITY.plum_raw.carbs));
      const potG = Math.round(Math.max(0, c - Math.round(plumG * FOOD_DENSITY.plum_raw.carbs)) / FOOD_DENSITY.potato_russet_raw.carbs);
      const remFat = Math.max(0, f - Math.round(steakG * FOOD_DENSITY.flank_steak.fat));
      return [
        { text: `<strong>Preparation:</strong> Sear flank steak, let rest, and slice thin. Toss spinach, sliced plums, and olive oil dressing. Serve potatoes on the side.` },
        { name: "Flank Steak", category: "proteins", qty: steakG, unit: "g", text: `<strong>Flank Steak (Raw):</strong> ${steakG}g ${toOz(steakG)}` },
        { name: "Plums", category: "produce", qty: plumG, unit: "g", text: `<strong>Fresh Plums:</strong> ${plumG}g` },
        { name: "Russet Potatoes", category: "starches", qty: potG, unit: "g", text: potG > 10 ? `<strong>Russet Potatoes (Raw):</strong> ${potG}g` : `` },
        { name: "Fresh Spinach", category: "produce", qty: 80, unit: "g", text: `<strong>Fresh Spinach:</strong> 80g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_flank_steak_butter_carnivore", name: "Flank Steak & Butter", slot: "dinner", archetypes: ["carnivore", "keto"], keywords: ["steak", "flank", "beef"],
    build: (p, c, f) => {
      const steakG = Math.round(p / FOOD_DENSITY.flank_steak.protein);
      const remFat = Math.max(0, f - Math.round(steakG * FOOD_DENSITY.flank_steak.fat));
      return [
        { text: `<strong>Preparation:</strong> Sear flank steak to desired doneness, let rest, and slice against the grain. Top with melted grass-fed butter.` },
        { name: "Flank Steak", category: "proteins", qty: steakG, unit: "g", text: `<strong>Flank Steak (Raw):</strong> ${steakG}g ${toOz(steakG)}` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_seitan_sweet_potato_vegan", name: "Seitan & Sweet Potato Skillet", slot: "dinner", archetypes: ["vegan", "vegetarian"], keywords: ["seitan", "sweet potato", "vegan"],
    build: (p, c, f) => {
      const seitanG = Math.round(p / FOOD_DENSITY.seitan.protein);
      const spG = Math.round(Math.max(0, c - Math.round(seitanG * FOOD_DENSITY.seitan.carbs)) / FOOD_DENSITY.sweet_potato_raw.carbs);
      const remFat = Math.max(0, f - Math.round(seitanG * FOOD_DENSITY.seitan.fat));
      return [
        { text: `<strong>Preparation:</strong> Pan-sear sliced seitan until browned. Roast cubed sweet potato. Toss together with olive oil and steamed broccoli.` },
        { name: "Seitan", category: "proteins", qty: seitanG, unit: "g", text: `<strong>Seitan:</strong> ${seitanG}g ${toOz(seitanG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Raw):</strong> ${spG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 100, unit: "g", text: `<strong>Broccoli Florets:</strong> 100g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_salmon_sweet_potato_kale", name: "Atlantic Salmon, Sweet Potato & Kale", slot: "dinner", archetypes: ["omnivore", "paleo"], keywords: ["salmon", "sweet potato", "kale", "fish"],
    build: (p, c, f) => {
      const salmonG = Math.min(220, Math.max(100, Math.round(f / FOOD_DENSITY.salmon_raw.fat)));
      const remPro = Math.max(0, p - Math.round(salmonG * FOOD_DENSITY.salmon_raw.protein));
      const shrimpG = Math.round(remPro / FOOD_DENSITY.shrimp_raw.protein);
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      
      return [
        { text: `<strong>Preparation:</strong> Bake sweet potato wedges and salmon at 400°F. Massage fresh kale with olive oil and roast lightly for a crispy bed.` },
        { name: "Atlantic Salmon", category: "proteins", qty: salmonG, unit: "g", text: `<strong>Atlantic Salmon (Raw):</strong> ${salmonG}g ${toOz(salmonG)}` },
        { name: "Raw Shrimp", category: "proteins", qty: shrimpG > 5 ? shrimpG : 0, unit: "g", text: shrimpG > 5 ? `<strong>Raw Shrimp Booster:</strong> ${shrimpG}g` : `` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Raw):</strong> ${spG}g` },
        { name: "Kale", category: "produce", qty: 80, unit: "g", text: `<strong>Fresh Kale:</strong> 80g` }
      ];
    }
  },
  {
    id: "d_chuck_roast_mash", name: "Slow-Braised Chuck Roast & Mash", slot: "dinner", archetypes: ["omnivore", "keto", "paleo"], keywords: ["beef", "roast", "potato"],
    build: (p, c, f) => {
      const roastG = Math.round(p / FOOD_DENSITY.chuck_roast_trimmed.protein);
      const roastFat = Math.round(roastG * FOOD_DENSITY.chuck_roast_trimmed.fat);
      const potG = Math.round(c / FOOD_DENSITY.potato_russet_raw.carbs);
      const remFat = Math.max(0, f - roastFat);
      return [
        { text: `<strong>Preparation:</strong> Trim the visible fat from the chuck roast and braise it in beef broth for 3-4 hours until fork-tender. Serve over mashed potatoes.` },
        { name: "Chuck Roast, Trimmed", category: "proteins", qty: roastG, unit: "g", text: `<strong>Trimmed Chuck Roast (Raw):</strong> ${roastG}g ${toOz(roastG)}` },
        { name: "Russet Potatoes", category: "starches", qty: potG, unit: "g", text: potG > 10 ? `<strong>Russet Potatoes (Raw):</strong> ${potG}g` : `` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_chicken_thigh_root_veg", name: "Chicken Thighs & Roasted Root Veg", slot: "dinner", archetypes: ["omnivore"], keywords: ["chicken", "thigh", "carrots", "beets"],
    build: (p, c, f) => {
      const carrotG = Math.min(150, Math.round((c * 0.5) / FOOD_DENSITY.carrots_raw.carbs));
      const beetG = Math.round(Math.max(0, c - Math.round(carrotG * FOOD_DENSITY.carrots_raw.carbs)) / FOOD_DENSITY.beets_raw.carbs);
      const thighG = Math.round(Math.max(0, p - Math.round(carrotG * FOOD_DENSITY.carrots_raw.protein) - Math.round(beetG * FOOD_DENSITY.beets_raw.protein)) / FOOD_DENSITY.chicken_thigh.protein);
      const remFat = Math.max(0, f - Math.round(thighG * FOOD_DENSITY.chicken_thigh.fat));
      return [
        { text: `<strong>Preparation:</strong> Chop carrots and beets, toss in olive oil, and roast at 400°F. Bake skinless chicken thighs alongside until golden brown.` },
        { name: "Chicken Thigh", category: "proteins", qty: thighG, unit: "g", text: `<strong>Chicken Thigh, Skinless (Raw):</strong> ${thighG}g ${toOz(thighG)}` },
        { name: "Carrots", category: "produce", qty: carrotG, unit: "g", text: `<strong>Carrots:</strong> ${carrotG}g` },
        { name: "Beets", category: "produce", qty: beetG, unit: "g", text: beetG > 10 ? `<strong>Beets (Raw):</strong> ${beetG}g` : `` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },

  // --- 3 NEW DINNER RECIPES (built from ingredients already on the grocery list) ---
  {
    id: "d_flank_steak_sweet_potato_skillet", name: "Flank Steak & Sweet Potato Skillet", slot: "dinner", archetypes: ["omnivore", "paleo"], keywords: ["flank", "steak", "beef", "sweet potato"],
    build: (p, c, f) => {
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      const steakG = Math.max(60, Math.round((p - Math.round(spG * FOOD_DENSITY.sweet_potato_raw.protein)) / FOOD_DENSITY.flank_steak.protein));
      const remFat = Math.max(0, f - Math.round(steakG * FOOD_DENSITY.flank_steak.fat));
      return [
        { text: `<strong>Preparation:</strong> Sear flank steak to desired doneness and slice against the grain. Sauté diced sweet potato and asparagus in the same skillet.` },
        { name: "Flank Steak", category: "proteins", qty: steakG, unit: "g", text: `<strong>Flank Steak (Raw):</strong> ${steakG}g ${toOz(steakG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Diced):</strong> ${spG}g` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_chicken_rice_broccoli_skillet", name: "Chicken, Rice & Broccoli Skillet", slot: "dinner", archetypes: ["omnivore"], keywords: ["chicken", "rice", "broccoli"],
    build: (p, c, f) => {
      const riceG = Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs);
      const chickenG = Math.max(60, Math.round((p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein)) / FOOD_DENSITY.chicken_breast.protein));
      const remFat = Math.max(0, f - Math.round(chickenG * FOOD_DENSITY.chicken_breast.fat) - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.fat));
      return [
        { text: `<strong>Preparation:</strong> Cook jasmine rice. Sear diced chicken breast in a skillet with broccoli florets until chicken is cooked through and broccoli is tender-crisp.` },
        { name: "Chicken Breast", category: "proteins", qty: chickenG, unit: "g", text: `<strong>Chicken Breast (Raw):</strong> ${chickenG}g ${toOz(chickenG)}` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 150, unit: "g", text: `<strong>Broccoli Florets:</strong> 150g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_shrimp_avocado_rice_bowl", name: "Shrimp & Avocado Rice Bowl", slot: "dinner", archetypes: ["omnivore", "pescatarian"], keywords: ["shrimp", "avocado", "rice", "seafood"],
    build: (p, c, f) => {
      const riceG = Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs);
      const shrimpG = Math.max(60, Math.round((p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein)) / FOOD_DENSITY.shrimp_raw.protein));
      const remFat = Math.max(0, f - Math.round(shrimpG * FOOD_DENSITY.shrimp_raw.fat) - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Cook jasmine rice. Sauté shrimp with lime and chili flakes. Serve over rice topped with sliced avocado and steamed asparagus.` },
        { name: "Raw Shrimp", category: "proteins", qty: shrimpG, unit: "g", text: `<strong>Raw Shrimp:</strong> ${shrimpG}g ${toOz(shrimpG)}` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },

  // --- 7 MORE DINNER RECIPES (built from ingredients already on the grocery list, no seafood) ---
  {
    id: "d_turkey_rice_broccoli_dinner", name: "Turkey Breast & Rice Dinner", slot: "dinner", archetypes: ["omnivore"], keywords: ["turkey", "rice", "broccoli"],
    build: (p, c, f) => {
      const riceG = Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs);
      const turkeyG = Math.max(60, Math.round((p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein)) / FOOD_DENSITY.turkey_breast.protein));
      const remFat = Math.max(0, f - Math.round(turkeyG * FOOD_DENSITY.turkey_breast.fat) - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.fat));
      return [
        { text: `<strong>Preparation:</strong> Cook jasmine rice. Roast or pan-sear turkey breast and slice. Steam broccoli florets. Drizzle everything with olive oil.` },
        { name: "Turkey Breast", category: "proteins", qty: turkeyG, unit: "g", text: `<strong>Turkey Breast:</strong> ${turkeyG}g ${toOz(turkeyG)}` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 150, unit: "g", text: `<strong>Broccoli Florets:</strong> 150g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_sirloin_sweet_potato_dinner_plate", name: "Sirloin & Sweet Potato Dinner Plate", slot: "dinner", archetypes: ["omnivore", "paleo", "keto"], keywords: ["sirloin", "steak", "sweet potato"],
    build: (p, c, f) => {
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      const steakG = Math.max(60, Math.round((p - Math.round(spG * FOOD_DENSITY.sweet_potato_raw.protein)) / FOOD_DENSITY.sirloin_steak.protein));
      const remFat = Math.max(0, f - Math.round(steakG * FOOD_DENSITY.sirloin_steak.fat));
      return [
        { text: `<strong>Preparation:</strong> Grill top sirloin steak to desired doneness. Roast cubed sweet potato and asparagus alongside.` },
        { name: "Top Sirloin Steak", category: "proteins", qty: steakG, unit: "g", text: `<strong>Top Sirloin (Raw):</strong> ${steakG}g ${toOz(steakG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Raw):</strong> ${spG}g` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_pork_tenderloin_rice_skillet", name: "Pork Tenderloin & Rice Skillet", slot: "dinner", archetypes: ["omnivore"], keywords: ["pork", "tenderloin", "rice", "zucchini"],
    build: (p, c, f) => {
      const riceG = Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs);
      const porkG = Math.max(60, Math.round((p - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.protein)) / FOOD_DENSITY.pork_tenderloin.protein));
      const remFat = Math.max(0, f - Math.round(porkG * FOOD_DENSITY.pork_tenderloin.fat) - Math.round(riceG * FOOD_DENSITY.jasmine_rice_dry.fat));
      return [
        { text: `<strong>Preparation:</strong> Cook jasmine rice. Sauté sliced pork tenderloin and zucchini in a skillet until pork is cooked through.` },
        { name: "Pork Tenderloin", category: "proteins", qty: porkG, unit: "g", text: `<strong>Pork Tenderloin (Raw):</strong> ${porkG}g ${toOz(porkG)}` },
        { name: "Jasmine White Rice", category: "starches", qty: riceG, unit: "g", text: `<strong>Jasmine Rice (Dry):</strong> ${riceG}g` },
        { name: "Zucchini", category: "produce", qty: 100, unit: "g", text: `<strong>Zucchini:</strong> 100g` },
        { name: "Olive Oil", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Olive Oil:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_ribeye_sweet_potato_steakhouse", name: "Ribeye & Sweet Potato Steakhouse Plate", slot: "dinner", archetypes: ["omnivore", "keto", "paleo"], keywords: ["ribeye", "steak", "sweet potato"],
    build: (p, c, f) => {
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      const steakG = Math.max(60, Math.round((p - Math.round(spG * FOOD_DENSITY.sweet_potato_raw.protein)) / FOOD_DENSITY.ribeye_steak.protein));
      const remFat = Math.max(0, f - Math.round(steakG * FOOD_DENSITY.ribeye_steak.fat));
      return [
        { text: `<strong>Preparation:</strong> Sear ribeye in a cast-iron skillet, basting with butter. Roast cubed sweet potato and asparagus.` },
        { name: "Ribeye Steak", category: "proteins", qty: steakG, unit: "g", text: `<strong>Ribeye Steak (Raw):</strong> ${steakG}g ${toOz(steakG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Raw):</strong> ${spG}g` },
        { name: "Asparagus", category: "produce", qty: 100, unit: "g", text: `<strong>Asparagus:</strong> 100g` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "d_tempeh_sweet_potato_dinner_bowl_vegan", name: "Tempeh & Sweet Potato Dinner Bowl", slot: "dinner", archetypes: ["vegan", "vegetarian"], keywords: ["tempeh", "sweet potato", "broccoli", "vegan"],
    build: (p, c, f) => {
      const spG = Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs);
      const tempehG = Math.max(60, Math.round(Math.max(0, p - Math.round(spG * FOOD_DENSITY.sweet_potato_raw.protein)) / FOOD_DENSITY.tempeh_organic.protein));
      const remFat = Math.max(0, f - Math.round(tempehG * FOOD_DENSITY.tempeh_organic.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Roast cubed sweet potato and broccoli. Pan-sear sliced tempeh until crisp. Combine in a bowl and top with sliced avocado.` },
        { name: "Organic Tempeh", category: "proteins", qty: tempehG, unit: "g", text: `<strong>Tempeh (Sliced):</strong> ${tempehG}g ${toOz(tempehG)}` },
        { name: "Sweet Potato", category: "starches", qty: spG, unit: "g", text: `<strong>Sweet Potato (Raw):</strong> ${spG}g` },
        { name: "Broccoli Florets", category: "produce", qty: 150, unit: "g", text: `<strong>Broccoli Florets:</strong> 150g` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },
  {
    id: "d_seitan_black_bean_chili_bowl_vegan", name: "Seitan & Black Bean Chili Bowl", slot: "dinner", archetypes: ["vegan", "vegetarian"], keywords: ["seitan", "black beans", "bell pepper", "vegan"],
    build: (p, c, f) => {
      const beanG = Math.round((c * 0.6) / FOOD_DENSITY.black_beans_cooked.carbs);
      const seitanG = Math.max(60, Math.round(Math.max(0, p - Math.round(beanG * FOOD_DENSITY.black_beans_cooked.protein)) / FOOD_DENSITY.seitan.protein));
      const remFat = Math.max(0, f - Math.round(seitanG * FOOD_DENSITY.seitan.fat) - Math.round(beanG * FOOD_DENSITY.black_beans_cooked.fat));
      const avoG = Math.round(remFat / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Simmer black beans, diced bell pepper, and crumbled seitan together with chili spices until thickened. Top with sliced avocado.` },
        { name: "Seitan", category: "proteins", qty: seitanG, unit: "g", text: `<strong>Seitan (Crumbled):</strong> ${seitanG}g ${toOz(seitanG)}` },
        { name: "Black Beans (Cooked)", category: "starches", qty: beanG, unit: "g", text: `<strong>Black Beans (Cooked):</strong> ${beanG}g` },
        { name: "Bell Pepper", category: "produce", qty: 120, unit: "g", text: `<strong>Bell Pepper (Diced):</strong> 120g` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },
  {
    id: "d_chuck_roast_root_veggie_dinner", name: "Chuck Roast & Root Veggie Dinner", slot: "dinner", archetypes: ["omnivore", "paleo"], keywords: ["chuck roast", "beef", "potato", "carrots"],
    build: (p, c, f) => {
      const potG = Math.round(c / FOOD_DENSITY.potato_russet_raw.carbs);
      const beefG = Math.max(60, Math.round((p - Math.round(potG * FOOD_DENSITY.potato_russet_raw.protein)) / FOOD_DENSITY.chuck_roast_trimmed.protein));
      const remFat = Math.max(0, f - Math.round(beefG * FOOD_DENSITY.chuck_roast_trimmed.fat));
      return [
        { text: `<strong>Preparation:</strong> Trim the visible fat from the chuck roast and slow-cook it with russet potatoes and carrots until fork-tender. Shred beef before serving.` },
        { name: "Chuck Roast, Trimmed", category: "proteins", qty: beefG, unit: "g", text: `<strong>Trimmed Chuck Roast (Raw):</strong> ${beefG}g ${toOz(beefG)}` },
        { name: "Russet Potatoes", category: "starches", qty: potG, unit: "g", text: `<strong>Russet Potatoes (Raw):</strong> ${potG}g` },
        { name: "Carrots", category: "produce", qty: 80, unit: "g", text: `<strong>Carrots:</strong> 80g` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },

  // --- SNACKS ---
  {
    id: "s_greek_yogurt", name: "Greek Yogurt & Berry Bowl", slot: "snack", archetypes: ["omnivore", "vegetarian"], keywords: ["yogurt", "berries", "dairy"],
    build: (p, c, f) => {
      const gyG = Math.min(280, Math.round(p / FOOD_DENSITY.greek_yogurt_0pct.protein));
      const wheyG = Math.round(Math.max(0, p - Math.round(gyG * FOOD_DENSITY.greek_yogurt_0pct.protein)) / FOOD_DENSITY.whey_isolate.protein);
      const berryG = Math.round(c / FOOD_DENSITY.berries_mixed.carbs);
      const almondG = Math.round(f / FOOD_DENSITY.almonds_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Mix nonfat Greek yogurt and whey. Top with berries and raw almonds.` },
        { name: "0% Greek Yogurt", category: "dairy", qty: gyG, unit: "g", text: `<strong>0% Greek Yogurt:</strong> ${gyG}g` },
        { name: "Whey Protein Isolate", category: "proteins", qty: wheyG, unit: "g", text: wheyG > 5 ? `<strong>Whey Isolate:</strong> ${wheyG}g` : `` },
        { name: "Mixed Berries", category: "produce", qty: berryG, unit: "g", text: c > 5 ? `<strong>Fresh Berries:</strong> ${berryG}g` : `` },
        { name: "Raw Almonds", category: "fats", qty: almondG, unit: "g", text: `<strong>Raw Almonds:</strong> ${almondG}g` }
      ];
    }
  },
  {
    id: "s_string_cheese_jerky_apple", name: "String Cheese, Beef Jerky & Apple", slot: "snack", archetypes: ["omnivore", "paleo"], keywords: ["cheese", "jerky", "beef", "apple"],
    build: (p, c, f) => {
      // Reworked for the USDA values: beef jerky is about a quarter fat, so the jerky is limited to part of the protein and of the fat, and egg whites carry the rest of the protein.
      const stick = UNIT_WEIGHT_G.pieces;
      const cheese = Math.min(3, Math.max(1, Math.floor((f * 0.4) / (stick * FOOD_DENSITY.string_cheese.fat))));
      const cheeseP = cheese * stick * FOOD_DENSITY.string_cheese.protein;
      const jerkyG = Math.round(Math.max(0, Math.min(((p - cheeseP) * 0.5) / FOOD_DENSITY.beef_jerky.protein, (f * 0.45) / FOOD_DENSITY.beef_jerky.fat)));
      const whitesG = Math.round(Math.max(0, p - cheeseP - (jerkyG * FOOD_DENSITY.beef_jerky.protein)) / FOOD_DENSITY.egg_whites_liquid.protein);
      const appleG = Math.round(Math.max(0, c - (cheese * stick * FOOD_DENSITY.string_cheese.carbs) - Math.round(jerkyG * FOOD_DENSITY.beef_jerky.carbs) - (whitesG * FOOD_DENSITY.egg_whites_liquid.carbs)) / FOOD_DENSITY.apple_raw.carbs);
      const remFat = Math.max(0, f - (cheese * stick * FOOD_DENSITY.string_cheese.fat) - (jerkyG * FOOD_DENSITY.beef_jerky.fat));
      const seedG = Math.round(remFat / FOOD_DENSITY.pumpkin_seeds.fat);
      return [
        { text: `<strong>Preparation:</strong> Ready-to-eat snack pack. Pair string cheese with beef jerky, hard-boiled egg whites, pumpkin seeds, and fresh apple slices.` },
        { name: "String Cheese", category: "dairy", qty: cheese, unit: "pieces", text: `<strong>String Cheese:</strong> ${cheese} stick(s)` },
        { name: "Beef Jerky", category: "proteins", qty: jerkyG, unit: "g", text: jerkyG > 5 ? `<strong>Beef Jerky:</strong> ${jerkyG}g` : `` },
        { name: "Liquid Egg Whites", category: "proteins", qty: whitesG, unit: "g", text: whitesG > 10 ? `<strong>Hard-Boiled Egg Whites:</strong> ${whitesG}g` : `` },
        { name: "Raw Apple", category: "produce", qty: appleG, unit: "g", text: appleG > 5 ? `<strong>Fresh Apple:</strong> ${appleG}g` : `` },
        { name: "Pumpkin Seeds", category: "fats", qty: seedG, unit: "g", text: seedG > 2 ? `<strong>Pumpkin Seeds:</strong> ${seedG}g` : `` }
      ];
    }
  },
  {
    id: "s_melon_mint_protein", name: "Honeydew Melon & Plant Protein Refresher", slot: "snack", archetypes: ["vegan", "vegetarian"], keywords: ["honeydew", "plant protein", "shake", "melon"],
    build: (p, c, f) => {
      const powderG = Math.round(p / FOOD_DENSITY.plant_protein.protein);
      const melonG = Math.round(c / FOOD_DENSITY.honeydew_raw.carbs);
      const almondG = Math.round(f / FOOD_DENSITY.almonds_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Shake plant protein with cold water. Eat cubed honeydew melon and almonds on the side.` },
        { name: "Plant Protein Isolate", category: "proteins", qty: powderG, unit: "g", text: `<strong>Plant Protein Shake:</strong> ${powderG}g` },
        { name: "Honeydew Melon", category: "produce", qty: melonG, unit: "g", text: melonG > 10 ? `<strong>Honeydew Melon:</strong> ${melonG}g` : `` },
        { name: "Raw Almonds", category: "fats", qty: almondG, unit: "g", text: almondG > 2 ? `<strong>Raw Almonds:</strong> ${almondG}g` : `` }
      ];
    }
  },
  {
    id: "s_watermelon_casein", name: "Watermelon & Casein Protein", slot: "snack", archetypes: ["omnivore", "vegetarian"], keywords: ["watermelon", "casein", "dairy"],
    build: (p, c, f) => {
      const caseinG = Math.round(p / FOOD_DENSITY.casein_protein.protein);
      const waterG = Math.min(500, Math.round(c / FOOD_DENSITY.watermelon_raw.carbs));
      const walnutG = Math.round(f / FOOD_DENSITY.walnuts_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Mix casein with cold water until thick. Enjoy sweet watermelon cubes and walnuts alongside.` },
        { name: "Casein Protein", category: "proteins", qty: caseinG, unit: "g", text: `<strong>Casein Protein:</strong> ${caseinG}g` },
        { name: "Watermelon", category: "produce", qty: waterG, unit: "g", text: waterG > 10 ? `<strong>Watermelon Cubes:</strong> ${waterG}g` : `` },
        { name: "Raw Walnuts", category: "fats", qty: walnutG, unit: "g", text: walnutG > 2 ? `<strong>Raw Walnuts:</strong> ${walnutG}g` : `` }
      ];
    }
  },
  {
    id: "s_cantaloupe_jerky", name: "Cantaloupe & Beef Jerky", slot: "snack", archetypes: ["omnivore", "paleo"], keywords: ["cantaloupe", "jerky", "beef", "melon"],
    build: (p, c, f) => {
      // Reworked for the USDA values: beef jerky is about a quarter fat, so the jerky is limited to part of the protein and of the fat, and hard-boiled egg whites carry the rest.
      const jerkyG = Math.round(Math.max(0, Math.min((p * 0.5) / FOOD_DENSITY.beef_jerky.protein, (f * 0.7) / FOOD_DENSITY.beef_jerky.fat)));
      const whitesG = Math.round(Math.max(0, p - (jerkyG * FOOD_DENSITY.beef_jerky.protein)) / FOOD_DENSITY.egg_whites_liquid.protein);
      const cantaloupeG = Math.round(Math.max(0, c - Math.round(jerkyG * FOOD_DENSITY.beef_jerky.carbs) - (whitesG * FOOD_DENSITY.egg_whites_liquid.carbs)) / FOOD_DENSITY.cantaloupe_raw.carbs);
      const seedG = Math.round(Math.max(0, f - Math.round(jerkyG * FOOD_DENSITY.beef_jerky.fat)) / FOOD_DENSITY.pumpkin_seeds.fat);
      return [
        { text: `<strong>Preparation:</strong> Ready-to-eat snack. Pair savory beef jerky and hard-boiled egg whites with sweet cantaloupe slices and pumpkin seeds.` },
        { name: "Beef Jerky", category: "proteins", qty: jerkyG, unit: "g", text: jerkyG > 5 ? `<strong>Beef Jerky:</strong> ${jerkyG}g` : `` },
        { name: "Liquid Egg Whites", category: "proteins", qty: whitesG, unit: "g", text: whitesG > 10 ? `<strong>Hard-Boiled Egg Whites:</strong> ${whitesG}g` : `` },
        { name: "Cantaloupe", category: "produce", qty: cantaloupeG, unit: "g", text: cantaloupeG > 10 ? `<strong>Cantaloupe Slices:</strong> ${cantaloupeG}g` : `` },
        { name: "Pumpkin Seeds", category: "fats", qty: seedG, unit: "g", text: seedG > 2 ? `<strong>Pumpkin Seeds:</strong> ${seedG}g` : `` }
      ];
    }
  },
  {
    id: "s_jerky_eggs_carnivore", name: "Beef Jerky & Hard-Boiled Eggs", slot: "snack", archetypes: ["keto"], keywords: ["jerky", "beef", "egg"],
    build: (p, c, f) => {
      // Reworked for the USDA values: beef jerky carries about 11 g of carbs and 26 g of fat per 100 g, so the carbs cap the jerky, the eggs carry the rest of the protein,
      // and macadamia nuts fill the fat. A keto snack only (a zero-carb plan cannot have jerky).
      const jerkyG = Math.round(Math.max(0, Math.min((p * 0.5) / FOOD_DENSITY.beef_jerky.protein, (c * 0.8) / FOOD_DENSITY.beef_jerky.carbs)));
      const eggs = Math.min(6, Math.max(1, Math.round(Math.max(0, p - (jerkyG * FOOD_DENSITY.beef_jerky.protein)) / FOOD_DENSITY.egg_whole_large.protein)));
      const remFat = Math.max(0, f - Math.round(jerkyG * FOOD_DENSITY.beef_jerky.fat) - (eggs * FOOD_DENSITY.egg_whole_large.fat));
      const nutG = Math.round(remFat / FOOD_DENSITY.macadamia_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Ready-to-eat. Pair beef jerky with hard-boiled eggs and a handful of macadamia nuts, and a pinch of sea salt.` },
        { name: "Hard-Boiled Eggs", category: "proteins", qty: eggs, unit: "large", text: `<strong>Hard-Boiled Eggs:</strong> ${eggs} large` },
        { name: "Beef Jerky", category: "proteins", qty: jerkyG, unit: "g", text: jerkyG > 5 ? `<strong>Beef Jerky:</strong> ${jerkyG}g` : `` },
        { name: "Raw Macadamia Nuts", category: "fats", qty: nutG, unit: "g", text: nutG > 2 ? `<strong>Raw Macadamia Nuts:</strong> ${nutG}g` : `` }
      ];
    }
  },
  {
    id: "s_cheese_egg_macadamia_keto", name: "Cheese, Egg & Macadamia Snack Plate", slot: "snack", archetypes: ["keto"], keywords: ["cheese", "egg", "macadamia", "keto"],
    build: (p, c, f) => {
      // A keto snack: hard-boiled eggs and string cheese for the protein, macadamia nuts for the rest of the fat. Almost no carbs.
      const stick = UNIT_WEIGHT_G.pieces;
      const eggs = Math.min(4, Math.max(1, Math.round((p * 0.4) / FOOD_DENSITY.egg_whole_large.protein)));
      const cheese = Math.min(6, Math.max(0, Math.round(Math.max(0, p - (eggs * FOOD_DENSITY.egg_whole_large.protein)) / (stick * FOOD_DENSITY.string_cheese.protein))));
      const remFat = Math.max(0, f - (eggs * FOOD_DENSITY.egg_whole_large.fat) - (cheese * stick * FOOD_DENSITY.string_cheese.fat));
      const nutG = Math.round(remFat / FOOD_DENSITY.macadamia_raw.fat);
      return [
        { text: `<strong>Preparation:</strong> Ready-to-eat. Hard-boil the eggs, and plate them with string cheese and a handful of macadamia nuts.` },
        { name: "Hard-Boiled Eggs", category: "proteins", qty: eggs, unit: "large", text: `<strong>Hard-Boiled Eggs:</strong> ${eggs} large` },
        { name: "String Cheese", category: "dairy", qty: cheese, unit: "pieces", text: cheese > 0 ? `<strong>String Cheese:</strong> ${cheese} stick(s)` : `` },
        { name: "Raw Macadamia Nuts", category: "fats", qty: nutG, unit: "g", text: nutG > 2 ? `<strong>Raw Macadamia Nuts:</strong> ${nutG}g` : `` }
      ];
    }
  },
  {
    id: "s_steak_bites_eggs_carnivore", name: "Steak Bites & Hard-Boiled Eggs", slot: "snack", archetypes: ["carnivore", "keto"], keywords: ["steak", "ribeye", "egg", "beef", "carnivore"],
    build: (p, c, f) => {
      // A carnivore snack: ribeye bites and hard-boiled eggs (protein and fat in about equal parts, no carbs), with butter for any fat still missing.
      const eggs = Math.min(5, Math.max(1, Math.round((p * 0.3) / FOOD_DENSITY.egg_whole_large.protein)));
      const steakG = Math.round(Math.max(0, p - (eggs * FOOD_DENSITY.egg_whole_large.protein)) / FOOD_DENSITY.ribeye_steak.protein);
      const remFat = Math.max(0, f - (eggs * FOOD_DENSITY.egg_whole_large.fat) - Math.round(steakG * FOOD_DENSITY.ribeye_steak.fat));
      return [
        { text: `<strong>Preparation:</strong> Sear ribeye bites in butter and season with sea salt. Serve warm with hard-boiled eggs.` },
        { name: "Ribeye Steak", category: "proteins", qty: steakG, unit: "g", text: `<strong>Ribeye (Raw):</strong> ${steakG}g ${toOz(steakG)}` },
        { name: "Hard-Boiled Eggs", category: "proteins", qty: eggs, unit: "large", text: `<strong>Hard-Boiled Eggs:</strong> ${eggs} large` },
        { name: "Grass-Fed Butter", category: "fats", qty: remFat, unit: "g", text: remFat > 2 ? `<strong>Butter:</strong> ${(remFat/4.5).toFixed(1)} tsp` : `` }
      ];
    }
  },
  {
    id: "s_tuna_rice_cakes_pescatarian", name: "Canned Tuna & Rice Cakes", slot: "snack", archetypes: ["omnivore", "pescatarian"], keywords: ["tuna", "rice cakes", "fish", "seafood"],
    build: (p, c, f) => {
      const tunaG = Math.round(p / FOOD_DENSITY.tuna_canned.protein);
      const cakes = Math.max(1, Math.min(3, Math.round(c / FOOD_DENSITY.rice_cake.carbs)));
      const avoG = Math.round(f / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Ready-to-eat. Mix canned tuna with a squeeze of lemon, serve on rice cakes with mashed avocado.` },
        { name: "Canned Tuna", category: "proteins", qty: tunaG, unit: "g", text: `<strong>Canned Tuna (Drained):</strong> ${tunaG}g` },
        { name: "Rice Cakes", category: "starches", qty: cakes, unit: "cakes", text: `<strong>Plain Rice Cakes:</strong> ${cakes} cake(s)` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado:</strong> ${avoG}g` : `` }
      ];
    }
  },
  {
    id: "s_hard_boiled_eggs_celery", name: "Hard Boiled Eggs & Celery Sticks", slot: "snack", archetypes: ["omnivore", "vegetarian", "paleo"], keywords: ["egg", "celery", "avocado"],
    build: (p, c, f) => {
      const eggs = Math.min(3, Math.max(1, Math.floor((f * 0.7) / FOOD_DENSITY.egg_whole_large.fat)));
      const wheyG = Math.round(Math.max(0, p - (eggs * 6.3)) / FOOD_DENSITY.whey_isolate.protein);
      const celeryG = Math.min(500, Math.round(c / FOOD_DENSITY.celery_raw.carbs));
      const avoG = Math.round(Math.max(0, f - (eggs * 5.0)) / FOOD_DENSITY.avocado_hass.fat);
      return [
        { text: `<strong>Preparation:</strong> Hard boil eggs. Use mashed avocado as a dip for celery sticks. Drink whey on the side if needed.` },
        { name: "Whole Eggs", category: "proteins", qty: eggs, unit: "large", text: `<strong>Hard-Boiled Eggs:</strong> ${eggs} large` },
        { name: "Whey Protein Isolate", category: "proteins", qty: wheyG, unit: "g", text: wheyG > 5 ? `<strong>Whey Shake (Side):</strong> ${wheyG}g` : `` },
        { name: "Celery", category: "produce", qty: celeryG, unit: "g", text: celeryG > 10 ? `<strong>Celery Sticks:</strong> ${celeryG}g` : `` },
        { name: "Hass Avocado", category: "fats", qty: avoG, unit: "g", text: avoG > 5 ? `<strong>Avocado (Dip):</strong> ${avoG}g` : `` }
      ];
    }
  }
];
