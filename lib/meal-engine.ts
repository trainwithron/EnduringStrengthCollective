// Ported from the coach's own standalone "Client Check-In & Complete Meal
// Engine" HTML tool (meal_engine_food_density_refactor.html) — same food
// density table, recipe database, and check-in/macro-adjustment math,
// translated to TypeScript and stripped of DOM/localStorage access so it
// can run inside the app. No AI involved yet, per the request: this is
// the coach's existing deterministic rules engine, wired in as-is.

export type Archetype = "omnivore" | "vegetarian" | "vegan" | "carnivore" | "keto" | "paleo";
export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack" | "any";
export type Phase = "fat_loss" | "maintenance" | "hypertrophy";

export interface RecipeHelperOptions {
  enableLiquid: boolean;
  produce: string;
}

export interface Recipe {
  id: string;
  name: string;
  slot: MealSlot;
  archetype: Archetype[];
  keywords: string[];
  build: (p: number, c: number, f: number, opt: RecipeHelperOptions) => string[];
}

function toOz(grams: number): string {
  return (grams / 28.35).toFixed(1);
}

// =============================================================================
// FOOD DENSITY TABLE
// Macro content per gram of raw/dry food (protein/carbs/fat), or per fixed
// unit for foods that are always used in one standard serving (an egg, a
// slice of bread, a rice cake, a block of tofu). Recipes reference these
// instead of embedding the numbers directly, so a single correction here
// propagates to every recipe that uses it.
// =============================================================================
export const FOOD_DENSITY = {
  chicken_breast: { protein: 0.23, fat: 0.025 },
  ground_turkey_93_7: { protein: 0.2, fat: 0.07 },
  ground_beef_93_7: { protein: 0.21, fat: 0.075 },
  ground_beef_85_15: { protein: 0.21, fat: 0.15 },
  ground_beef_80_20: { protein: 0.2, fat: 0.2 },
  beef_chuck_roast: { protein: 0.21, fat: 0.18 },
  sirloin_steak: { protein: 0.22, fat: 0.055 },
  white_fish: { protein: 0.18, fat: 0.02 },
  salmon: { protein: 0.2, fat: 0.13 },
  shrimp_or_cod: { protein: 0.23 },
  beef_jerky: { protein: 0.55 },
  seitan: { protein: 0.25 },
  edamame: { protein: 0.12 },
  egg_white_liquid: { protein: 0.11 },
  greek_yogurt: { protein: 0.1 },
  soy_yogurt: { protein: 0.06 },
  cheese_cheddar: { protein: 0.25, fat: 0.3 },
  whey_isolate: { protein: 0.75 },
  plant_protein: { protein: 0.75 },
  collagen_peptides: { protein: 0.9 },
  nuts_almonds: { protein: 0.2, fat: 0.5 },
  nut_butter: { protein: 0.25, fat: 0.5 },

  jasmine_rice_dry: { carbs: 0.8, protein: 0.07 },
  cream_of_rice_dry: { carbs: 0.8 },
  rolled_oats: { carbs: 0.68, protein: 0.13, fat: 0.06 },
  potato_raw: { carbs: 0.17, protein: 0.02 },
  sweet_potato_raw: { carbs: 0.2 },
  rice_noodles_dry: { carbs: 0.75, protein: 0.08 },
  berries: { carbs: 0.12 },
  fruit_general: { carbs: 0.15 },

  avocado: { fat: 0.15 },

  whole_egg: { protein: 6, fat: 5 },
  sourdough_slice: { carbs: 15, protein: 3 },
  rice_cake: { carbs: 13 },
  maple_syrup_tbsp: { carbs: 13 },
  tofu_extra_firm: { protein: 20, fat: 10, servingGrams: 225 },
  tempeh: { protein: 28, fat: 16, servingGrams: 150 },
} as const;

// =============================================================================
// MASTER RECIPE DATABASE
// =============================================================================
export const RECIPE_DATABASE: Recipe[] = [
  // --- BREAKFAST ---
  {
    id: "b_egg_toast",
    name: "Pasture Eggs & Sourdough Scramble + Fruit",
    slot: "breakfast",
    archetype: ["omnivore", "vegetarian"],
    keywords: ["egg", "eggs", "toast", "sourdough", "bread"],
    build: (p, c, f, opt) => {
      const wholeEggs = f >= 10 ? 2 : 1;
      const fatFromEggs = wholeEggs * 5;
      const proFromEggs = wholeEggs * 6;
      const addedFat = Math.max(0, f - fatFromEggs);

      const toastSlices = Math.min(4, Math.max(1, Math.round(c / 15)));
      const carbsFromToast = toastSlices * 15;
      const proFromToast = toastSlices * 3;
      const eggWhites = Math.max(50, Math.round((p - proFromEggs - proFromToast) / FOOD_DENSITY.egg_white_liquid.protein));
      const carbsRem = Math.max(0, c - carbsFromToast);

      const items = [
        `<strong>Whole Eggs:</strong> ${wholeEggs} large (${fatFromEggs}g inherent fat)`,
        `<strong>Liquid Egg Whites:</strong> ${eggWhites}g (~${toOz(eggWhites)} oz)`,
        `<strong>Sourdough Bread:</strong> ${toastSlices} slices toasted (${carbsFromToast}g carbs)`,
      ];

      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          const juiceOz = Math.round(carbsRem / 3.5);
          items.push(`<strong>100% Fruit Juice / Fluid Carb:</strong> ${juiceOz} fl oz [${carbsRem}g carbs]`);
        } else if (carbsRem >= 30) {
          const honeyTbsp = Math.min(2, Math.round((carbsRem / 13) * 10) / 10);
          items.push(
            `<strong>Fresh Fruit & Pure Maple Syrup:</strong> 120g Berries/Banana (~15g carbs) + ${honeyTbsp} tbsp Pure Maple Syrup / Raw Honey [${carbsRem}g carbs]`
          );
        } else {
          const berryG = Math.round(carbsRem / FOOD_DENSITY.berries.carbs);
          items.push(`<strong>Fresh Strawberries / Blueberries:</strong> ${berryG}g (~${toOz(berryG)} oz) [${carbsRem}g carbs]`);
        }
      }

      items.push(
        addedFat > 2
          ? `<strong>Grass-Fed Butter / Olive Oil:</strong> ${(addedFat / 4.5).toFixed(1)} tsp for cooking/toast`
          : `<strong>Added Fat:</strong> 0 tsp (Covered by egg yolks)`
      );
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "b_power_oats",
    name: "High-Protein Oatmeal Power Bowl",
    slot: "breakfast",
    archetype: ["omnivore", "vegetarian"],
    keywords: ["oat", "oats", "oatmeal", "whey", "peanut butter"],
    build: (p, c, f, opt) => {
      let dryOatsGrams: number;
      let fruitItem = "";
      let fluidItem = "";

      if (opt.enableLiquid) {
        dryOatsGrams = Math.min(60, Math.max(40, Math.round((c * 0.6) / FOOD_DENSITY.rolled_oats.carbs)));
        const carbsFromOats = Math.round(dryOatsGrams * FOOD_DENSITY.rolled_oats.carbs);
        const carbsRem = Math.max(0, c - carbsFromOats);
        if (carbsRem > 0) {
          const juiceOz = Math.round(carbsRem / 3.5);
          fluidItem = `<strong>100% Tart Cherry / Orange Juice:</strong> ${juiceOz} fl oz on the side [${carbsRem}g carbs]`;
        }
      } else {
        const fruitCarbs = c >= 45 ? 15 : 0;
        const mapleCarbs = c >= 75 ? 13 : 0;
        if (fruitCarbs > 0) fruitItem = `<strong>Fresh Berries / Sliced Banana Topping:</strong> 120g (~${toOz(120)} oz) [15g carbs]`;
        if (mapleCarbs > 0) fruitItem += ` + 1 tbsp Pure Maple Syrup [13g carbs]`;

        const carbsForOats = Math.max(25, c - fruitCarbs - mapleCarbs);
        dryOatsGrams = Math.round(carbsForOats / FOOD_DENSITY.rolled_oats.carbs);
      }

      const carbsFromOats = Math.round(dryOatsGrams * FOOD_DENSITY.rolled_oats.carbs);
      const proFromOats = Math.round(dryOatsGrams * FOOD_DENSITY.rolled_oats.protein);
      const fatFromOats = Math.round(dryOatsGrams * FOOD_DENSITY.rolled_oats.fat);

      const addedFat = Math.max(0, f - fatFromOats);
      const pbGrams = Math.round(addedFat / FOOD_DENSITY.nut_butter.fat);
      const proFromPB = Math.round(pbGrams * FOOD_DENSITY.nut_butter.protein);
      const wheyGrams = Math.max(15, Math.round((p - proFromOats - proFromPB) / FOOD_DENSITY.whey_isolate.protein));

      const items = [
        `<strong>Rolled Oats:</strong> ${dryOatsGrams}g (~${(dryOatsGrams / 40).toFixed(1)} half-cups / ${(dryOatsGrams / 80).toFixed(2)} cups) [${carbsFromOats}g carbs]`,
        `<strong>Whey / Casein Isolate:</strong> ${wheyGrams}g (~${(wheyGrams / 25).toFixed(1)} scoops stirred in)`,
      ];

      if (fruitItem) items.push(fruitItem);
      if (fluidItem) items.push(fluidItem);

      items.push(
        pbGrams > 0
          ? `<strong>All-Natural Nut Butter:</strong> ${pbGrams}g (~${(pbGrams / 16).toFixed(1)} tbsp)`
          : `<strong>Added Fat:</strong> 0 tbsp (Covered by oats)`
      );
      return items;
    },
  },
  {
    id: "b_greek_yogurt",
    name: "Hybrid Greek Yogurt & Cream of Rice Parfait",
    slot: "breakfast",
    archetype: ["omnivore", "vegetarian"],
    keywords: ["yogurt", "greek yogurt", "cream of rice", "cor", "dairy"],
    build: (p, c, f, opt) => {
      const baseGy = 340;
      const proFromYogurtBase = Math.round(baseGy * FOOD_DENSITY.greek_yogurt.protein);
      const wheyNeeded = Math.max(0, Math.round((p - proFromYogurtBase) / FOOD_DENSITY.whey_isolate.protein));

      let corGrams: number;
      let fruitItem = "";
      let fluidItem = "";

      if (opt.enableLiquid || c >= 90) {
        corGrams = Math.min(80, Math.max(40, Math.round((c * 0.7) / FOOD_DENSITY.cream_of_rice_dry.carbs)));
        const carbsFromCor = Math.round(corGrams * FOOD_DENSITY.cream_of_rice_dry.carbs);
        const carbsRem = Math.max(0, c - carbsFromCor - 15);
        fruitItem = `<strong>Fresh Mixed Berry Topping:</strong> 120g (~${toOz(120)} oz) [15g carbs]`;
        if (carbsRem > 0) {
          const juiceOz = Math.round(carbsRem / 3.5);
          fluidItem = `<strong>100% Tart Cherry / Pomegranate Juice:</strong> ${juiceOz} fl oz [${carbsRem}g carbs]`;
        }
      } else {
        const fruitCarbs = c >= 35 ? 15 : 0;
        const mapleCarbs = c >= 65 ? 13 : 0;
        if (fruitCarbs > 0) fruitItem = `<strong>Fresh Mixed Berry Topping:</strong> 120g (~${toOz(120)} oz) [15g carbs]`;
        if (mapleCarbs > 0) fruitItem += ` + 1.0 tbsp Pure Maple Syrup [13g carbs]`;

        const carbsForCor = Math.max(20, c - fruitCarbs - mapleCarbs);
        corGrams = Math.round(carbsForCor / FOOD_DENSITY.cream_of_rice_dry.carbs);
      }

      const carbsFromCor = Math.round(corGrams * FOOD_DENSITY.cream_of_rice_dry.carbs);

      const items = [
        `<strong>0% Plain Greek Yogurt:</strong> ${baseGy}g (~12 oz) [${proFromYogurtBase}g Protein base]`,
        wheyNeeded > 5
          ? `<strong>Whey Isolate:</strong> ${wheyNeeded}g (~${(wheyNeeded / 25).toFixed(1)} scoops stirred in)`
          : `<strong>Protein Note:</strong> Fully met by Greek yogurt base`,
        `<strong>Cream of Rice:</strong> ${corGrams}g (~${toOz(corGrams)} oz) [${carbsFromCor}g carbs]`,
      ];

      if (fruitItem) items.push(fruitItem);
      if (fluidItem) items.push(fluidItem);

      items.push(
        `<strong>Raw Almonds / Chia Seeds:</strong> ${Math.round(f / FOOD_DENSITY.nuts_almonds.fat)}g (~${toOz(
          Math.round(f / FOOD_DENSITY.nuts_almonds.fat)
        )} oz)`
      );
      return items;
    },
  },
  {
    id: "b_vegan_tofu",
    name: "Hybrid Tofu Scramble & Sourdough Toast",
    slot: "breakfast",
    archetype: ["vegan", "vegetarian"],
    keywords: ["tofu", "toast", "sourdough", "bread", "vegan", "plant-based"],
    build: (p, c, f, opt) => {
      const tofuGrams = FOOD_DENSITY.tofu_extra_firm.servingGrams;
      const proFromTofu = FOOD_DENSITY.tofu_extra_firm.protein;
      const fatFromTofu = FOOD_DENSITY.tofu_extra_firm.fat;
      const proRem = Math.max(0, p - proFromTofu);
      const plantPowderG = Math.round(proRem / FOOD_DENSITY.plant_protein.protein);

      const toastSlices = Math.min(4, Math.max(1, Math.round(c / 15)));
      const carbsFromToast = toastSlices * 15;
      const carbsRem = Math.max(0, c - carbsFromToast);
      const addedFat = Math.max(0, f - fatFromTofu);
      const avoGrams = Math.round(addedFat / FOOD_DENSITY.avocado.fat);

      const items = [
        `<strong>Extra Firm Organic Tofu:</strong> ${tofuGrams}g (~8 oz) [${proFromTofu}g Protein, ${fatFromTofu}g fat base]`,
        plantPowderG > 5
          ? `<strong>Pea / Rice Protein Isolate (Side Shake):</strong> ${plantPowderG}g (~${(plantPowderG / 25).toFixed(1)} scoops) [Provides remaining ${proRem}g Protein]`
          : "",
        `<strong>Sourdough Bread:</strong> ${toastSlices} slices toasted (${carbsFromToast}g carbs)`,
      ].filter(Boolean);

      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          const juiceOz = Math.round(carbsRem / 3.5);
          items.push(`<strong>100% Pure Fruit Juice:</strong> ${juiceOz} fl oz [${carbsRem}g carbs]`);
        } else {
          const fruitG = Math.round(carbsRem / FOOD_DENSITY.berries.carbs);
          items.push(`<strong>Fresh Fruit / Berries:</strong> ${fruitG}g [${carbsRem}g carbs]`);
        }
      }

      items.push(
        addedFat > 2
          ? `<strong>Fresh Hass Avocado / Olive Oil:</strong> ${avoGrams}g avocado (~${(addedFat / 4.5).toFixed(1)} tsp oil)`
          : `<strong>Added Fat:</strong> 0 tsp (Covered by tofu lipids)`
      );
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "b_vegan_oats",
    name: "Plant Protein Oatmeal Power Bowl",
    slot: "breakfast",
    archetype: ["vegan", "vegetarian"],
    keywords: ["oat", "oats", "oatmeal", "plant protein", "vegan"],
    build: (p, c, f) => {
      const dryOatsGrams = Math.min(80, Math.round((c > 60 ? c - 20 : c * 0.85) / FOOD_DENSITY.rolled_oats.carbs));
      const carbsFromOats = Math.round(dryOatsGrams * FOOD_DENSITY.rolled_oats.carbs);
      const proFromOats = Math.round(dryOatsGrams * FOOD_DENSITY.rolled_oats.protein);
      const fatFromOats = Math.round(dryOatsGrams * FOOD_DENSITY.rolled_oats.fat);

      const carbsRem = Math.max(0, c - carbsFromOats);
      const addedFat = Math.max(0, f - fatFromOats);
      const pbGrams = Math.round(addedFat / FOOD_DENSITY.nut_butter.fat);
      const proFromPB = Math.round(pbGrams * FOOD_DENSITY.nut_butter.protein);
      const plantPowderG = Math.max(15, Math.round((p - proFromOats - proFromPB) / FOOD_DENSITY.plant_protein.protein));

      const items = [
        `<strong>Rolled Oats:</strong> ${dryOatsGrams}g (~${(dryOatsGrams / 40).toFixed(1)} half-cups / ${(dryOatsGrams / 80).toFixed(2)} cups) [${carbsFromOats}g carbs]`,
        `<strong>Pea / Rice Protein Isolate:</strong> ${plantPowderG}g (~${(plantPowderG / 25).toFixed(1)} scoops)`,
      ];

      if (carbsRem > 0) {
        const fruitG = Math.round(carbsRem / FOOD_DENSITY.berries.carbs);
        items.push(`<strong>Fresh Berries / Sliced Banana:</strong> ${fruitG}g topping [${carbsRem}g carbs]`);
      }

      items.push(
        pbGrams > 0
          ? `<strong>All-Natural Nut Butter:</strong> ${pbGrams}g (~${(pbGrams / 16).toFixed(1)} tbsp)`
          : `<strong>Added Fat:</strong> 0 tbsp (Covered by oats)`
      );
      return items;
    },
  },
  {
    id: "b_vegan_parfait",
    name: "Soy Yogurt & Cream of Rice Parfait",
    slot: "breakfast",
    archetype: ["vegan", "vegetarian"],
    keywords: ["soy yogurt", "cream of rice", "cor", "vegan"],
    build: (p, c, f) => {
      const soyYogurtG = 250;
      const proFromSoyYogurt = Math.round(soyYogurtG * FOOD_DENSITY.soy_yogurt.protein);
      const plantPowderG = Math.max(15, Math.round((p - proFromSoyYogurt) / FOOD_DENSITY.plant_protein.protein));
      const corGrams = Math.min(80, Math.round((c > 60 ? c - 20 : c * 0.85) / FOOD_DENSITY.cream_of_rice_dry.carbs));
      const carbsFromCor = Math.round(corGrams * FOOD_DENSITY.cream_of_rice_dry.carbs);
      const carbsRem = Math.max(0, c - carbsFromCor);

      const items = [
        `<strong>Plain Unsweetened Soy Yogurt:</strong> ${soyYogurtG}g (~9 oz)`,
        `<strong>Plant Protein Isolate (Stirred In):</strong> ${plantPowderG}g (~${(plantPowderG / 25).toFixed(1)} scoops)`,
        `<strong>Cream of Rice:</strong> ${corGrams}g (~${toOz(corGrams)} oz) [${carbsFromCor}g carbs]`,
        `<strong>Chia Seeds / Raw Walnuts:</strong> ${Math.round(f / FOOD_DENSITY.nuts_almonds.fat)}g`,
      ];

      if (carbsRem > 0) {
        const mapleTbsp = (carbsRem / 13).toFixed(1);
        items.push(`<strong>100% Pure Maple Syrup & Fruit:</strong> ${mapleTbsp} tbsp Pure Maple Syrup [${carbsRem}g carbs]`);
      }
      return items;
    },
  },
  {
    id: "b_carnivore_scramble",
    name: "Whole Eggs & Ground Beef Scramble",
    slot: "breakfast",
    archetype: ["carnivore", "keto"],
    keywords: ["beef", "egg", "eggs"],
    build: (p) => {
      const wholeEggs = 3;
      const proFromEggs = wholeEggs * FOOD_DENSITY.whole_egg.protein;
      const fatFromEggsFixed = wholeEggs * FOOD_DENSITY.whole_egg.fat;
      const beefGrams = Math.round(Math.max(0, p - proFromEggs) / FOOD_DENSITY.ground_beef_85_15.protein);
      const fatFromBeef = Math.round(beefGrams * FOOD_DENSITY.ground_beef_85_15.fat);
      const f = 0; // fat target is inherent-only for this recipe, matching source
      const addedButter = Math.max(0, f - fatFromEggsFixed - fatFromBeef);
      return [
        `<strong>Whole Pasture-Raised Eggs:</strong> ${wholeEggs} large (${proFromEggs}g P, ${fatFromEggsFixed}g F)`,
        `<strong>85/15 Ground Beef:</strong> ${beefGrams}g (~${toOz(beefGrams)} oz) [${fatFromBeef}g inherent fat]`,
        addedButter > 2
          ? `<strong>Grass-Fed Butter / Tallow:</strong> ${(addedButter / 4.5).toFixed(1)} tsp`
          : `<strong>Cooking Fat:</strong> 0 tsp (Covered by beef & eggs)`,
        `<strong>Electrolytes:</strong> 1/2 tsp Redmond Real Salt / Sea Salt`,
      ];
    },
  },

  // --- LUNCH / MIDDAY ---
  {
    id: "l_chicken_rice",
    name: "Chicken Breast & Jasmine Rice Bowl",
    slot: "lunch",
    archetype: ["omnivore"],
    keywords: ["chicken", "rice", "jasmine rice"],
    build: (p, c, f, opt) => {
      const riceGrams = Math.min(130, Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs));
      const carbsFromRice = Math.round(riceGrams * FOOD_DENSITY.jasmine_rice_dry.carbs);
      const carbsRem = Math.max(0, c - carbsFromRice);
      const proFromRice = Math.round(riceGrams * FOOD_DENSITY.jasmine_rice_dry.protein);
      const chickenGrams = Math.max(60, Math.round((p - proFromRice) / FOOD_DENSITY.chicken_breast.protein));
      const inherentFat = Math.round(chickenGrams * FOOD_DENSITY.chicken_breast.fat);
      const addedFat = Math.max(0, f - inherentFat);

      const items = [
        `<strong>Chicken Breast:</strong> ${chickenGrams}g (~${toOz(chickenGrams)} oz)`,
        `<strong>Jasmine White Rice:</strong> ${riceGrams}g (~${toOz(riceGrams)} oz dry) [${carbsFromRice}g carbs]`,
      ];
      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          items.push(`<strong>100% Fruit Juice / Fluid Carb (Low Appetite Mode):</strong> ${Math.round(carbsRem / 3.5)} fl oz [${carbsRem}g carbs]`);
        } else {
          items.push(
            `<strong>Extra Jasmine Rice (Cap Overflow):</strong> +${Math.round(carbsRem / FOOD_DENSITY.jasmine_rice_dry.carbs)}g [${carbsRem}g carbs - starch cap exceeded, add more rice or a second carb side]`
          );
        }
      }
      items.push(`<strong>Extra Virgin Olive Oil:</strong> ${(addedFat / 4.5).toFixed(1)} tsp drizzle [Deducted ${inherentFat}g chicken fat]`);
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "l_turkey_potato",
    name: "93/7 Ground Turkey & Diced Potato Hash",
    slot: "lunch",
    archetype: ["omnivore", "paleo"],
    keywords: ["turkey", "potato", "potatoes"],
    build: (p, c, f, opt) => {
      const potatoGrams = Math.min(450, Math.round(c / FOOD_DENSITY.potato_raw.carbs));
      const carbsFromPot = Math.round(potatoGrams * FOOD_DENSITY.potato_raw.carbs);
      const carbsRem = Math.max(0, c - carbsFromPot);
      const proFromPot = Math.round(potatoGrams * FOOD_DENSITY.potato_raw.protein);
      const turkeyGrams = Math.max(60, Math.round((p - proFromPot) / FOOD_DENSITY.ground_turkey_93_7.protein));
      const inherentFat = Math.round(turkeyGrams * FOOD_DENSITY.ground_turkey_93_7.fat);
      const addedFat = Math.max(0, f - inherentFat);

      const items = [
        `<strong>93/7 Lean Ground Turkey:</strong> ${turkeyGrams}g (~${toOz(turkeyGrams)} oz) [${inherentFat}g inherent fat]`,
        `<strong>Red / Russet Potatoes:</strong> ${potatoGrams}g (~${toOz(potatoGrams)} oz) [${carbsFromPot}g carbs]`,
      ];
      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          items.push(`<strong>100% Fruit Juice / Fluid Carb (Low Appetite Mode):</strong> ${Math.round(carbsRem / 3.5)} fl oz [${carbsRem}g carbs]`);
        } else {
          items.push(
            `<strong>Extra Potatoes (Cap Overflow):</strong> +${Math.round(carbsRem / FOOD_DENSITY.potato_raw.carbs)}g [${carbsRem}g carbs - starch cap exceeded, add more potato or a second carb side]`
          );
        }
      }
      items.push(
        addedFat > 2
          ? `<strong>Fresh Avocado / Olive Oil:</strong> ${Math.round(addedFat / FOOD_DENSITY.avocado.fat)}g avocado`
          : `<strong>Added Fat:</strong> 0 tsp (Covered by turkey)`
      );
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "l_fish_noodles",
    name: "White Fish & Rice Noodles",
    slot: "lunch",
    archetype: ["omnivore"],
    keywords: ["fish", "cod", "tilapia", "pasta", "noodles"],
    build: (p, c, f, opt) => {
      const pastaGrams = Math.min(130, Math.round(c / FOOD_DENSITY.rice_noodles_dry.carbs));
      const carbsFromPasta = Math.round(pastaGrams * FOOD_DENSITY.rice_noodles_dry.carbs);
      const carbsRem = Math.max(0, c - carbsFromPasta);
      const proFromPasta = Math.round(pastaGrams * FOOD_DENSITY.rice_noodles_dry.protein);
      const fishGrams = Math.max(60, Math.round((p - proFromPasta) / FOOD_DENSITY.white_fish.protein));
      const addedFat = Math.max(0, f - Math.round(fishGrams * FOOD_DENSITY.white_fish.fat));

      const items = [
        `<strong>Cod / Tilapia / White Fish:</strong> ${fishGrams}g (~${toOz(fishGrams)} oz)`,
        `<strong>Brown Rice Noodles / Gluten-Free Pasta:</strong> ${pastaGrams}g (~${toOz(pastaGrams)} oz dry) [${carbsFromPasta}g carbs]`,
      ];
      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          items.push(`<strong>100% Fruit Juice / Fluid Carb (Low Appetite Mode):</strong> ${Math.round(carbsRem / 3.5)} fl oz [${carbsRem}g carbs]`);
        } else {
          items.push(
            `<strong>Extra Rice Noodles (Cap Overflow):</strong> +${Math.round(carbsRem / FOOD_DENSITY.rice_noodles_dry.carbs)}g [${carbsRem}g carbs - starch cap exceeded, add more pasta or a second carb side]`
          );
        }
      }
      items.push(`<strong>Extra Virgin Olive Oil:</strong> ${(addedFat / 4.5).toFixed(1)} tsp`);
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "l_vegan_tempeh",
    name: "Hybrid Tempeh & Jasmine Rice Bowl",
    slot: "lunch",
    archetype: ["vegan", "vegetarian"],
    keywords: ["tempeh", "rice", "jasmine rice", "vegan"],
    build: (p, c, f, opt) => {
      const tempehGrams = FOOD_DENSITY.tempeh.servingGrams;
      const proFromTempeh = FOOD_DENSITY.tempeh.protein;
      const fatFromTempeh = FOOD_DENSITY.tempeh.fat;
      const proRem = Math.max(0, p - proFromTempeh);
      const plantPowderG = Math.round(proRem / FOOD_DENSITY.plant_protein.protein);

      const riceGrams = Math.min(130, Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs));
      const carbsFromRice = Math.round(riceGrams * FOOD_DENSITY.jasmine_rice_dry.carbs);
      const carbsRem = Math.max(0, c - carbsFromRice);
      const addedFat = Math.max(0, f - fatFromTempeh);

      const items = [
        `<strong>Organic Soy Tempeh (Pan-Seared):</strong> ${tempehGrams}g (~5.3 oz) [${proFromTempeh}g Protein, ${fatFromTempeh}g fat base]`,
        plantPowderG > 5
          ? `<strong>Pea / Rice Protein Booster (In Sauce / Shake):</strong> ${plantPowderG}g (~${(plantPowderG / 25).toFixed(1)} scoops) [${proRem}g Protein]`
          : "",
        `<strong>Jasmine White Rice:</strong> ${riceGrams}g (~${toOz(riceGrams)} oz dry) [${carbsFromRice}g carbs]`,
      ].filter(Boolean);

      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          items.push(`<strong>100% Fruit Juice / Fluid Carb (Low Appetite Mode):</strong> ${Math.round(carbsRem / 3.5)} fl oz [${carbsRem}g carbs]`);
        } else {
          items.push(
            `<strong>Extra Jasmine Rice (Cap Overflow):</strong> +${Math.round(carbsRem / FOOD_DENSITY.jasmine_rice_dry.carbs)}g [${carbsRem}g carbs - starch cap exceeded, add more rice or a second carb side]`
          );
        }
      }
      items.push(addedFat > 2 ? `<strong>Sesame / Olive Oil:</strong> ${(addedFat / 4.5).toFixed(1)} tsp` : `<strong>Added Oil:</strong> 0 tsp (Covered by tempeh)`);
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "l_vegan_seitan",
    name: "High-Protein Seitan & Potato Hash",
    slot: "lunch",
    archetype: ["vegan", "vegetarian"],
    keywords: ["seitan", "potato", "potatoes", "vegan"],
    build: (p, c, f, opt) => {
      const seitanGrams = Math.round(p / FOOD_DENSITY.seitan.protein);
      const potGrams = Math.min(450, Math.round(c / FOOD_DENSITY.potato_raw.carbs));
      const carbsFromPot = Math.round(potGrams * FOOD_DENSITY.potato_raw.carbs);
      const carbsRem = Math.max(0, c - carbsFromPot);
      const avoGrams = Math.round(f / FOOD_DENSITY.avocado.fat);

      const items = [
        `<strong>Prepared Seitan:</strong> ${seitanGrams}g (~${toOz(seitanGrams)} oz) [${p}g High Protein Base, <3g fat]`,
        `<strong>Red / Russet Potatoes:</strong> ${potGrams}g (~${toOz(potGrams)} oz) [${carbsFromPot}g carbs]`,
      ];
      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          items.push(`<strong>100% Fruit Juice / Fluid Carb (Low Appetite Mode):</strong> ${Math.round(carbsRem / 3.5)} fl oz [${carbsRem}g carbs]`);
        } else {
          items.push(
            `<strong>Extra Potatoes (Cap Overflow):</strong> +${Math.round(carbsRem / FOOD_DENSITY.potato_raw.carbs)}g [${carbsRem}g carbs - starch cap exceeded, add more potato or a second carb side]`
          );
        }
      }
      items.push(`<strong>Fresh Hass Avocado:</strong> ${avoGrams}g (~${toOz(avoGrams)} oz)`);
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "l_carnivore_burgers",
    name: "80/20 Ground Beef Burger Patties",
    slot: "lunch",
    archetype: ["carnivore", "keto"],
    keywords: ["beef", "ground beef"],
    build: (p) => {
      const beefGrams = Math.round(p / FOOD_DENSITY.ground_beef_80_20.protein);
      return [
        `<strong>80/20 Ground Chuck Beef Patties:</strong> ${beefGrams}g (~${toOz(beefGrams)} oz)`,
        `<strong>Inherent Fat Content:</strong> ${Math.round(beefGrams * FOOD_DENSITY.ground_beef_80_20.fat)}g natural bovine fat (No added oils needed)`,
        `<strong>Seasoning:</strong> Coarse sea salt only`,
      ];
    },
  },

  // --- DINNER (single starch base — no double stacking) ---
  {
    id: "d_sirloin_sweet_potato",
    name: "Top Sirloin Steak & Sweet Potato (Sweet Potato Base)",
    slot: "dinner",
    archetype: ["omnivore", "paleo"],
    keywords: ["steak", "sirloin", "sweet potato"],
    build: (p, c, f, opt) => {
      const sweetPotGrams = Math.min(550, Math.max(100, Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs)));
      const carbsFromSP = Math.round(sweetPotGrams * FOOD_DENSITY.sweet_potato_raw.carbs);
      const carbsRem = Math.max(0, c - carbsFromSP);
      const steakGrams = Math.round(p / FOOD_DENSITY.sirloin_steak.protein);
      const inherentFat = Math.round(steakGrams * FOOD_DENSITY.sirloin_steak.fat);
      const addedFat = Math.max(0, f - inherentFat);

      const items = [
        `<strong>Top Sirloin Steak:</strong> ${steakGrams}g (~${toOz(steakGrams)} oz) [${inherentFat}g inherent fat]`,
        `<strong>Sweet Potato / Yams:</strong> ${sweetPotGrams}g (~${toOz(sweetPotGrams)} oz) [${carbsFromSP}g carbs - Single Starch Base]`,
      ];
      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          items.push(`<strong>100% Fruit Juice / Fluid Carb (Low Appetite Mode):</strong> ${Math.round(carbsRem / 3.5)} fl oz [${carbsRem}g carbs]`);
        } else {
          items.push(
            `<strong>Extra Sweet Potato (Cap Overflow):</strong> +${Math.round(carbsRem / FOOD_DENSITY.sweet_potato_raw.carbs)}g [${carbsRem}g carbs - starch cap exceeded, add more sweet potato or a second carb side]`
          );
        }
      }
      items.push(addedFat > 2 ? `<strong>Grass-Fed Butter:</strong> ${(addedFat / 4.5).toFixed(1)} tsp` : `<strong>Added Fat:</strong> 0 tsp (Covered by steak)`);
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "d_salmon_mash",
    name: "Atlantic Salmon & Yukon Gold Mash (Potato Base)",
    slot: "dinner",
    archetype: ["omnivore", "paleo"],
    keywords: ["salmon", "fish", "potato", "potatoes"],
    build: (p, c, f, opt) => {
      const salmonGrams = Math.min(190, Math.round(p / FOOD_DENSITY.salmon.protein));
      const proFromSalmon = Math.round(salmonGrams * FOOD_DENSITY.salmon.protein);
      const inherentFat = Math.round(salmonGrams * FOOD_DENSITY.salmon.fat);
      const proRem = Math.max(0, p - proFromSalmon);
      const shrimpGrams = Math.round(proRem / FOOD_DENSITY.shrimp_or_cod.protein);

      const potGrams = Math.min(550, Math.max(100, Math.round(c / FOOD_DENSITY.potato_raw.carbs)));
      const carbsFromPot = Math.round(potGrams * FOOD_DENSITY.potato_raw.carbs);
      const carbsRem = Math.max(0, c - carbsFromPot);

      const items = [`<strong>Atlantic Salmon Fillet:</strong> ${salmonGrams}g (~${toOz(salmonGrams)} oz) [Capped: ${proFromSalmon}g P, ${inherentFat}g Omega-3 Fat]`];
      if (proRem > 5) items.push(`<strong>Lean Protein Booster:</strong> ${shrimpGrams}g (~${toOz(shrimpGrams)} oz) Raw Shrimp or Cod (Provides remaining ${proRem}g Protein with 0g fat)`);
      items.push(`<strong>Yukon Gold Potatoes:</strong> ${potGrams}g (~${toOz(potGrams)} oz) [${carbsFromPot}g carbs - Single Starch Base]`);
      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          items.push(`<strong>100% Fruit Juice / Fluid Carb (Low Appetite Mode):</strong> ${Math.round(carbsRem / 3.5)} fl oz [${carbsRem}g carbs]`);
        } else {
          items.push(
            `<strong>Extra Potatoes (Cap Overflow):</strong> +${Math.round(carbsRem / FOOD_DENSITY.potato_raw.carbs)}g [${carbsRem}g carbs - starch cap exceeded, add more potato or a second carb side]`
          );
        }
      }
      items.push(`<strong>Added Cooking Fat:</strong> 0 tsp (Salmon covers meal fat allotment)`);
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "d_beef_rice",
    name: "93/7 Lean Ground Beef & Jasmine Rice Bowl (Rice Bowl Base)",
    slot: "dinner",
    archetype: ["omnivore"],
    keywords: ["ground beef", "beef", "rice", "jasmine rice"],
    build: (p, c, f, opt) => {
      const riceGrams = Math.min(150, Math.max(30, Math.round(c / FOOD_DENSITY.jasmine_rice_dry.carbs)));
      const carbsFromRice = Math.round(riceGrams * FOOD_DENSITY.jasmine_rice_dry.carbs);
      const carbsRem = Math.max(0, c - carbsFromRice);
      const proFromRice = Math.round(riceGrams * FOOD_DENSITY.jasmine_rice_dry.protein);
      const beefGrams = Math.max(60, Math.round((p - proFromRice) / FOOD_DENSITY.ground_beef_93_7.protein));
      const inherentFat = Math.round(beefGrams * FOOD_DENSITY.ground_beef_93_7.fat);
      const addedFat = Math.max(0, f - inherentFat);

      const items = [
        `<strong>93/7 Lean Ground Beef:</strong> ${beefGrams}g (~${toOz(beefGrams)} oz) [${inherentFat}g inherent fat]`,
        `<strong>Jasmine White Rice:</strong> ${riceGrams}g (~${toOz(riceGrams)} oz dry) [${carbsFromRice}g carbs - Single Starch Base]`,
      ];
      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          items.push(`<strong>100% Fruit Juice / Fluid Carb (Low Appetite Mode):</strong> ${Math.round(carbsRem / 3.5)} fl oz [${carbsRem}g carbs]`);
        } else {
          items.push(
            `<strong>Extra Jasmine Rice (Cap Overflow):</strong> +${Math.round(carbsRem / FOOD_DENSITY.jasmine_rice_dry.carbs)}g [${carbsRem}g carbs - starch cap exceeded, add more rice or a second carb side]`
          );
        }
      }
      items.push(
        addedFat > 2
          ? `<strong>Fresh Avocado:</strong> ${Math.round(addedFat / FOOD_DENSITY.avocado.fat)}g avocado`
          : `<strong>Added Fat:</strong> 0 tsp (Covered by beef)`
      );
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "d_vegan_tofu_sweet_potato",
    name: "Grilled Organic Tofu & Roasted Sweet Potatoes",
    slot: "dinner",
    archetype: ["vegan", "vegetarian"],
    keywords: ["tofu", "sweet potato", "vegan"],
    build: (p, c, f, opt) => {
      const tofuGrams = FOOD_DENSITY.tofu_extra_firm.servingGrams;
      const proFromTofu = FOOD_DENSITY.tofu_extra_firm.protein;
      const fatFromTofu = FOOD_DENSITY.tofu_extra_firm.fat;
      const proRem = Math.max(0, p - proFromTofu);
      const edamameGrams = Math.round(proRem / FOOD_DENSITY.edamame.protein);

      const sweetPotGrams = Math.min(550, Math.max(100, Math.round(c / FOOD_DENSITY.sweet_potato_raw.carbs)));
      const carbsFromSP = Math.round(sweetPotGrams * FOOD_DENSITY.sweet_potato_raw.carbs);
      const carbsRem = Math.max(0, c - carbsFromSP);
      const addedOil = Math.max(0, f - fatFromTofu);

      const items = [
        `<strong>Extra Firm Organic Tofu (Baked/Grilled):</strong> ${tofuGrams}g (~8 oz) [${proFromTofu}g Protein, ${fatFromTofu}g fat base]`,
        edamameGrams > 10
          ? `<strong>Steamed Shelled Edamame (Side):</strong> ${edamameGrams}g (~${toOz(edamameGrams)} oz) [Provides remaining ${proRem}g Protein]`
          : "",
        `<strong>Sweet Potato / Yams:</strong> ${sweetPotGrams}g (~${toOz(sweetPotGrams)} oz) [${carbsFromSP}g carbs - Single Starch Base]`,
      ].filter(Boolean);

      if (carbsRem > 0) {
        if (opt.enableLiquid) {
          items.push(`<strong>100% Fruit Juice / Fluid Carb (Low Appetite Mode):</strong> ${Math.round(carbsRem / 3.5)} fl oz [${carbsRem}g carbs]`);
        } else {
          items.push(
            `<strong>Extra Sweet Potato (Cap Overflow):</strong> +${Math.round(carbsRem / FOOD_DENSITY.sweet_potato_raw.carbs)}g [${carbsRem}g carbs - starch cap exceeded, add more sweet potato or a second carb side]`
          );
        }
      }
      items.push(addedOil > 2 ? `<strong>Extra Virgin Olive Oil:</strong> ${(addedOil / 4.5).toFixed(1)} tsp` : `<strong>Added Oil:</strong> 0 tsp (Covered by tofu)`);
      items.push(opt.produce);
      return items;
    },
  },
  {
    id: "d_carnivore_roast",
    name: "Beef Chuck Roast / Short Ribs (Slow Cooked)",
    slot: "dinner",
    archetype: ["carnivore", "keto"],
    keywords: ["beef", "roast", "ribs"],
    build: (p) => {
      const beefGrams = Math.round(p / FOOD_DENSITY.beef_chuck_roast.protein);
      return [
        `<strong>Beef Chuck Roast / Boneless Short Ribs:</strong> ${beefGrams}g (~${toOz(beefGrams)} oz)`,
        `<strong>Inherent Fat Content:</strong> ${Math.round(beefGrams * FOOD_DENSITY.beef_chuck_roast.fat)}g natural braised fat`,
        `<strong>Salt & Mineral Water:</strong> Season generously with coarse sea salt`,
      ];
    },
  },

  // --- SNACK ---
  {
    id: "s_yogurt_berries",
    name: "Greek Yogurt & Berries",
    slot: "snack",
    archetype: ["omnivore", "vegetarian"],
    keywords: ["yogurt", "greek yogurt", "berries", "dairy"],
    build: (p, c, f) => {
      const yogurtGrams = Math.max(100, Math.min(300, Math.round(p / FOOD_DENSITY.greek_yogurt.protein)));
      const proFromYogurt = Math.round(yogurtGrams * FOOD_DENSITY.greek_yogurt.protein);
      const wheyGrams = Math.max(0, Math.round((p - proFromYogurt) / FOOD_DENSITY.whey_isolate.protein));
      const berryGrams = Math.max(40, Math.round(c / FOOD_DENSITY.berries.carbs));
      const almondGrams = Math.round(f / FOOD_DENSITY.nuts_almonds.fat);

      return [
        `<strong>Plain Greek Yogurt (0-2%):</strong> ${yogurtGrams}g (~${toOz(yogurtGrams)} oz) [~${proFromYogurt}g Protein]`,
        wheyGrams > 5
          ? `<strong>Whey Isolate (Stirred In):</strong> ${wheyGrams}g (~${(wheyGrams / 25).toFixed(1)} scoops)`
          : `<strong>Protein Note:</strong> Fully met by yogurt base`,
        `<strong>Fresh Mixed Berries:</strong> ${berryGrams}g (~${toOz(berryGrams)} oz)`,
        `<strong>Raw Almonds / Walnuts:</strong> ${almondGrams}g (~${toOz(almondGrams)} oz)`,
      ];
    },
  },
  {
    id: "s_shake_ricecake",
    name: "Protein Shake & Rice Cakes",
    slot: "snack",
    archetype: ["omnivore", "vegetarian"],
    keywords: ["shake", "protein shake", "whey", "rice cakes"],
    build: (p, c, f) => {
      const wheyGrams = Math.max(20, Math.round(p / FOOD_DENSITY.whey_isolate.protein));
      const riceCakes = Math.max(1, Math.min(4, Math.round(c / FOOD_DENSITY.rice_cake.carbs)));
      const carbsFromCakes = riceCakes * FOOD_DENSITY.rice_cake.carbs;
      const carbsRem = Math.max(0, c - carbsFromCakes);
      const pbGrams = Math.round(f / FOOD_DENSITY.nut_butter.fat);

      const items = [
        `<strong>Whey / Casein Isolate (Mixed with Water):</strong> ${wheyGrams}g (~${(wheyGrams / 25).toFixed(1)} scoops)`,
        `<strong>Plain Rice Cakes:</strong> ${riceCakes} cakes (${carbsFromCakes}g carbs)`,
      ];
      if (carbsRem > 0) items.push(`<strong>Fresh Fruit (Apple / Banana):</strong> ~${carbsRem}g carbs worth`);
      items.push(pbGrams > 0 ? `<strong>All-Natural Nut Butter:</strong> ${pbGrams}g (~${(pbGrams / 16).toFixed(1)} tbsp)` : `<strong>Added Fat:</strong> 0 tbsp`);
      return items;
    },
  },
  {
    id: "s_vegan_shake_fruit",
    name: "Plant Protein Shake & Fruit",
    slot: "snack",
    archetype: ["vegan", "vegetarian"],
    keywords: ["shake", "protein shake", "plant protein", "fruit", "vegan"],
    build: (p, c, f) => {
      const powderGrams = Math.max(20, Math.round(p / FOOD_DENSITY.plant_protein.protein));
      const fruitGrams = Math.max(60, Math.round(c / FOOD_DENSITY.fruit_general.carbs));
      const nutButterGrams = Math.round(f / FOOD_DENSITY.nut_butter.fat);

      return [
        `<strong>Pea / Rice Protein Isolate (Mixed with Water):</strong> ${powderGrams}g (~${(powderGrams / 25).toFixed(1)} scoops)`,
        `<strong>Fresh Banana / Mixed Fruit:</strong> ${fruitGrams}g (~${toOz(fruitGrams)} oz)`,
        nutButterGrams > 0 ? `<strong>All-Natural Nut Butter:</strong> ${nutButterGrams}g (~${(nutButterGrams / 16).toFixed(1)} tbsp)` : `<strong>Added Fat:</strong> 0 tbsp`,
      ];
    },
  },
  {
    id: "s_carnivore_jerky_eggs",
    name: "Beef Jerky & Hard-Boiled Eggs",
    slot: "snack",
    archetype: ["carnivore", "keto"],
    keywords: ["jerky", "beef", "egg", "eggs"],
    build: (p, c, f) => {
      const eggs = Math.min(3, Math.max(1, Math.round(f / FOOD_DENSITY.whole_egg.fat)));
      const proFromEggs = eggs * FOOD_DENSITY.whole_egg.protein;
      const fatFromEggs = eggs * FOOD_DENSITY.whole_egg.fat;
      const jerkyGrams = Math.max(20, Math.round(Math.max(0, p - proFromEggs) / FOOD_DENSITY.beef_jerky.protein));

      return [
        `<strong>Hard-Boiled Whole Eggs:</strong> ${eggs} large (${fatFromEggs}g inherent fat)`,
        `<strong>Beef Jerky (No Added Sugar):</strong> ${jerkyGrams}g (~${toOz(jerkyGrams)} oz)`,
        `<strong>Electrolytes:</strong> 1/4 tsp Sea Salt`,
      ];
    },
  },
  {
    id: "s_keto_cheese_nuts",
    name: "Cheese & Nuts Plate",
    slot: "snack",
    archetype: ["keto", "vegetarian"],
    keywords: ["cheese", "nuts", "keto"],
    build: (p, c, f) => {
      const cheeseGrams = Math.max(30, Math.min(120, Math.round(p / FOOD_DENSITY.cheese_cheddar.protein)));
      const proFromCheese = Math.round(cheeseGrams * FOOD_DENSITY.cheese_cheddar.protein);
      const fatFromCheese = Math.round(cheeseGrams * FOOD_DENSITY.cheese_cheddar.fat);
      const nutsGrams = Math.round(Math.max(0, f - fatFromCheese) / FOOD_DENSITY.nuts_almonds.fat);
      const proRem = Math.max(0, p - proFromCheese);
      const nutButterProG = Math.round(nutsGrams * FOOD_DENSITY.nuts_almonds.protein);
      const collagenGrams = Math.max(0, Math.round((proRem - nutButterProG) / FOOD_DENSITY.collagen_peptides.protein));

      const items = [
        `<strong>Sharp Cheddar / Colby Jack Cheese:</strong> ${cheeseGrams}g (~${toOz(cheeseGrams)} oz)`,
        `<strong>Raw Almonds / Macadamia Nuts:</strong> ${nutsGrams}g (~${toOz(nutsGrams)} oz)`,
      ];
      if (collagenGrams > 5) items.push(`<strong>Unflavored Collagen Peptides (In Water):</strong> ${collagenGrams}g (~${(collagenGrams / 10).toFixed(1)} scoops)`);
      return items;
    },
  },
  {
    id: "s_paleo_nuts_fruit",
    name: "Mixed Nuts, Fruit & Collagen",
    slot: "snack",
    archetype: ["paleo", "keto"],
    keywords: ["nuts", "fruit", "collagen", "paleo"],
    build: (p, c, f) => {
      const nutsGrams = Math.max(20, Math.round(f / FOOD_DENSITY.nuts_almonds.fat));
      const proFromNuts = Math.round(nutsGrams * FOOD_DENSITY.nuts_almonds.protein);
      const collagenGrams = Math.max(0, Math.round((p - proFromNuts) / FOOD_DENSITY.collagen_peptides.protein));
      const fruitGrams = Math.max(40, Math.round(c / FOOD_DENSITY.fruit_general.carbs));

      const items = [`<strong>Raw Almonds / Walnuts / Macadamia:</strong> ${nutsGrams}g (~${toOz(nutsGrams)} oz)`];
      if (fruitGrams > 0 && c > 0) items.push(`<strong>Fresh Apple / Berries:</strong> ${fruitGrams}g (~${toOz(fruitGrams)} oz)`);
      if (collagenGrams > 5) items.push(`<strong>Unflavored Collagen Peptides (In Water/Coffee):</strong> ${collagenGrams}g (~${(collagenGrams / 10).toFixed(1)} scoops)`);
      return items;
    },
  },
];

export const FUNCTIONAL_CATEGORIES = [
  { group: "Dark Polyphenol & Nitric Oxide Category", produceOptions: "Baby spinach, Swiss chard, Arugula, or Steamed kale" },
  { group: "Citrus, Vitamin C & Enzyme Category", produceOptions: "Red/yellow bell peppers, Steamed broccoli, Cauliflower, or Brussels sprouts" },
  { group: "Electrolyte, Potassium & Hydration Category", produceOptions: "Grilled asparagus, Sautéed zucchini, Yellow squash, Celery, or Sliced cucumbers" },
  { group: "Anthocyanin & Recovery Category", produceOptions: "Steamed green beans, Sautéed zucchini, Mixed dark greens, or Roasted asparagus" },
];

export interface TreatEntry {
  key: string;
  name: string;
  cals: number;
  p: number;
  c: number;
  f: number;
}

export const TREAT_DATABASE: TreatEntry[] = [
  { key: "cheesecake", name: "Cheesecake (1 Standard Slice)", cals: 450, p: 8, c: 45, f: 28 },
  { key: "pizza", name: "Pizza (2 Slices Thin/Regular)", cals: 520, p: 22, c: 58, f: 22 },
  { key: "ice cream", name: "Ice Cream (1 Cup Premium)", cals: 380, p: 6, c: 42, f: 22 },
  { key: "donut", name: "Donut / Pastry (1 Large)", cals: 320, p: 4, c: 38, f: 18 },
  { key: "burger", name: "Restaurant Burger (with Bun)", cals: 600, p: 32, c: 45, f: 32 },
  { key: "cookie", name: "Large Bakery Cookie", cals: 350, p: 4, c: 48, f: 16 },
];

export function detectDietArchetype(text: string): Archetype {
  const t = (text || "").toLowerCase();
  if (t.includes("carnivore") || t.includes("zero carb") || t.includes("animal based") || t.includes("meat only")) return "carnivore";
  if (t.includes("vegan") || t.includes("plant-based") || t.includes("plant based")) return "vegan";
  if (t.includes("vegetarian")) return "vegetarian";
  if (t.includes("paleo") || t.includes("primal")) return "paleo";
  if (t.includes("keto") || t.includes("ketogenic")) return "keto";
  return "omnivore";
}

// =============================================================================
// CHECK-IN ENGINE — weight-trend + biofeedback driven calorie adjustment
// =============================================================================
export interface CheckInInput {
  phase: Phase;
  currentWeight: number;
  previousWeight: number;
  currentCalories: number;
  adherenceDays: number; // 0-7
  rateStrength: number; // 1-5
  rateRecovery: number; // 1-5
  rateDigestion: number; // 1-5
  rateSatiety: number; // 1-5 (1 = stuffed/poor appetite, 5 = starving)
  dietaryRestrictions: string;
  consecutiveSurplusSpikes?: number; // carried over from a prior check-in
}

export interface MacroTargets {
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface CheckInResult {
  archetype: Archetype;
  newAvgCalories: number;
  rationale: string;
  dailyBaseline: MacroTargets;
  consecutiveSurplusSpikes: number;
}

// Direct port of runCheckInEngine's calorie-adjustment branch + macro split
// — same weight-fluctuation buffer window, same phase-specific rules, same
// 2-week settling period for hypertrophy surplus spikes.
export function computeCheckIn(input: CheckInInput): CheckInResult {
  const {
    phase,
    currentWeight: currW,
    previousWeight: prevWRaw,
    currentCalories: currC,
    adherenceDays: adhr,
    rateStrength: rStrength,
    rateRecovery: rRecovery,
    rateDigestion: rDigestion,
    rateSatiety: rDiet,
    dietaryRestrictions,
  } = input;
  const prevW = prevWRaw || currW;
  const archetype = detectDietArchetype(dietaryRestrictions);

  let newAvgCals = currC;
  let rationale = "";
  let consecutiveSurplusSpikes = input.consecutiveSurplusSpikes ?? 0;

  const deltaW = currW - prevW;
  const absDeltaW = Math.abs(deltaW);
  const pctChange = prevW > 0 ? (deltaW / prevW) * 100 : 0;

  if (adhr < 5) {
    rationale = `Diet adherence was ${adhr}/7 days. Macros held steady to establish consistency before metabolic adjustments.`;
  } else if (absDeltaW >= 0.5 && absDeltaW <= 1.5) {
    newAvgCals = currC;
    rationale = `Weight change is holding within a normal physiological fluctuation range (0.5–1.5 lbs/week from glycogen, water, or sodium retention). Targets held steady until weight trend stabilizes.`;
  } else if (phase === "fat_loss") {
    if (pctChange > -0.3 && deltaW > -0.5) {
      if (rRecovery <= 2 || rStrength <= 2) {
        newAvgCals = Math.round(currC * 0.96);
        rationale = `Weight loss stalled (${pctChange.toFixed(2)}%), but recovery/strength is depressed. Applied a conservative 4% drop to preserve training output.`;
      } else {
        newAvgCals = Math.round(currC * 0.92);
        rationale = `Weight loss stalled (${pctChange.toFixed(2)}% change). Scaled calories down 8% (~${currC - newAvgCals} kcal) to restart fat loss.`;
      }
    } else if (pctChange < -1.5 || deltaW < -2.0) {
      newAvgCals = Math.round(currC * 1.05);
      rationale = `Weight loss rate was too rapid (${Math.abs(pctChange).toFixed(2)}% drop). Increased calories 5% to protect lean tissue.`;
    } else {
      rationale = `Fat loss rate is on track. Calorie targets held steady.`;
    }
  } else if (phase === "hypertrophy") {
    if (deltaW < -0.5) {
      consecutiveSurplusSpikes = 0;
      newAvgCals = currC + 175;
      rationale = `Weight decreased by ${Math.abs(deltaW).toFixed(1)} lbs during a muscle gain phase. Added +175 kcal daily to reverse loss and establish the target surplus.`;
    } else if (pctChange < 0.1 && deltaW <= 0.4) {
      consecutiveSurplusSpikes = 0;
      newAvgCals = currC + 125;
      rationale = `Scale weight stalled in surplus (${pctChange.toFixed(2)}% change). Added 125 kcal daily.`;
    } else if (pctChange > 0.6 || deltaW > 1.5) {
      consecutiveSurplusSpikes += 1;
      if (consecutiveSurplusSpikes >= 2) {
        newAvgCals = currC - 125;
        consecutiveSurplusSpikes = 0;
        rationale = `Weight increased above the weekly threshold for two consecutive check-ins (Week 1 spike + Week 2 continued rise). Trimmed 125 kcal to maintain optimal surplus velocity.`;
      } else {
        newAvgCals = currC;
        rationale = `Weight increased above the weekly threshold, but we are holding calories steady for a 2-week settling period to allow metabolism to adjust before making any downward adjustments.`;
      }
    } else {
      consecutiveSurplusSpikes = 0;
      rationale = `Hypertrophy surplus rate is right on track. Targets held steady.`;
    }
  } else {
    consecutiveSurplusSpikes = 0;
    rationale = `Maintenance phase targets held to stabilize body mass.`;
  }

  if (rDiet <= 2) {
    rationale += ` [Low appetite protocol: Fast-digesting / liquid carbs enabled for ease of consumption]`;
  }
  if (rDigestion <= 2) {
    rationale += ` [Low digestion detected (${rDigestion}/5): Substituted heavy fibrous starches with fast-digesting carbohydrates to reduce GI load]`;
  }

  const pro = Math.round(currW * 1.0);
  let baseCarb: number;
  let baseFat: number;
  let resolvedBaseCals: number;

  if (archetype === "carnivore") {
    baseCarb = 0;
    baseFat = Math.round((newAvgCals - pro * 4) / 9);
    resolvedBaseCals = pro * 4 + baseFat * 9;
  } else if (archetype === "keto") {
    baseCarb = 25;
    baseFat = Math.round((newAvgCals - pro * 4 - 25 * 4) / 9);
    resolvedBaseCals = pro * 4 + 25 * 4 + baseFat * 9;
  } else {
    baseFat = Math.max(45, Math.round((newAvgCals * 0.25) / 9));
    baseCarb = Math.max(50, Math.round((newAvgCals - pro * 4 - baseFat * 9) / 4));
    resolvedBaseCals = pro * 4 + baseCarb * 4 + baseFat * 9;
  }

  return {
    archetype,
    newAvgCalories: newAvgCals,
    rationale,
    dailyBaseline: { calories: resolvedBaseCals, protein: pro, carbs: baseCarb, fats: baseFat },
    consecutiveSurplusSpikes,
  };
}

export interface CarbCyclingTargets {
  trainingDay: MacroTargets;
  restDay: MacroTargets;
}

// Splits the daily baseline into a training-day (+10% cals, higher carb)
// and rest-day (lower cals, higher fat) target pair at the same weekly
// calorie budget.
export function computeCarbCyclingTargets(baseline: MacroTargets, trainingDaysPerWeek: number): CarbCyclingTargets {
  const restDays = 7 - trainingDaysPerWeek;
  const pro = baseline.protein;
  const weeklyBudget = baseline.calories * 7;

  const rawTrainCals = Math.round(baseline.calories * 1.1);
  const rawRestCals = Math.round((weeklyBudget - trainingDaysPerWeek * rawTrainCals) / restDays);

  const trainFat = Math.max(40, Math.round((rawTrainCals * 0.2) / 9));
  const trainCarb = Math.max(60, Math.round((rawTrainCals - pro * 4 - trainFat * 9) / 4));
  const trainCals = pro * 4 + trainCarb * 4 + trainFat * 9;

  const restFat = Math.max(45, Math.round((rawRestCals * 0.3) / 9));
  const restCarb = Math.max(30, Math.round((rawRestCals - pro * 4 - restFat * 9) / 4));
  const restCals = pro * 4 + restCarb * 4 + restFat * 9;

  return {
    trainingDay: { calories: trainCals, protein: pro, carbs: trainCarb, fats: trainFat },
    restDay: { calories: restCals, protein: pro, carbs: restCarb, fats: restFat },
  };
}

export interface FlexTreatSuggestion {
  treat: TreatEntry;
  dailyTrimCalories: number;
  sameDayCarbDrop: number;
  sameDayFatDrop: number;
}

// Matches a coach's "favorite foods" free text against the treat database
// and computes the two balancing options — a weekly buffer trim, or a
// same-day carb/fat drop. Returns null if nothing matched, or if the
// client is on the carnivore protocol (no flex-treat framing there).
export function matchFlexTreat(favoriteFoodsText: string, archetype: Archetype): FlexTreatSuggestion | null {
  const rawReq = (favoriteFoodsText || "").toLowerCase();
  if (!rawReq.trim() || archetype === "carnivore") return null;

  const treat = TREAT_DATABASE.find((t) => rawReq.includes(t.key));
  if (!treat) return null;

  return {
    treat,
    dailyTrimCalories: Math.round(treat.cals / 6),
    sameDayCarbDrop: Math.round(treat.c * 0.8),
    sameDayFatDrop: Math.round(treat.f * 0.8),
  };
}

export interface MealSpec {
  id: string;
  slot: MealSlot;
  title: string;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  categoryIndex: number;
}

// Splits daily macros into per-meal targets, largest-remainder rounding
// (same as the source's distribute() helper) so the parts always sum
// back to the whole.
function distribute(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  let remainder = total - base * parts;
  const out: number[] = [];
  for (let i = 0; i < parts; i++) {
    out.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return out;
}

export function buildMealSpecs(macros: MacroTargets, mealCount: number, includeSnack: boolean): MealSpec[] {
  const SNACK_FRACTION = 0.15;
  const snackP = includeSnack ? Math.round(macros.protein * SNACK_FRACTION) : 0;
  const snackC = includeSnack ? Math.round(macros.carbs * SNACK_FRACTION) : 0;
  const snackF = includeSnack ? Math.round(macros.fats * SNACK_FRACTION) : 0;

  const pParts = distribute(macros.protein - snackP, mealCount);
  const cParts = distribute(macros.carbs - snackC, mealCount);
  const fParts = distribute(macros.fats - snackF, mealCount);

  const specs: MealSpec[] = [];
  for (let i = 1; i <= mealCount; i++) {
    let slot: MealSlot;
    let title: string;
    if (i === 1) {
      slot = "breakfast";
      title = mealCount === 2 ? "Meal 1: Fast-Breaking Window" : "Meal 1: Breakfast";
    } else if (i === mealCount) {
      slot = "dinner";
      title = `Meal ${i}: Dinner & Recovery`;
    } else {
      slot = "lunch";
      title = mealCount === 3 ? "Meal 2: Lunch" : `Meal ${i}: Midday Meal ${i - 1}`;
    }
    specs.push({ id: String(i), slot, title, proteinTarget: pParts[i - 1], carbsTarget: cParts[i - 1], fatTarget: fParts[i - 1], categoryIndex: i - 1 });
  }

  if (includeSnack) {
    specs.push({ id: "snack", slot: "snack", title: "Snack: Between-Meal Fuel", proteinTarget: snackP, carbsTarget: snackC, fatTarget: snackF, categoryIndex: specs.length });
  }

  return specs;
}

export interface MealOption {
  recipeId: string;
  recipeName: string;
  ingredients: string[]; // HTML strings, same as the source (bold tags around quantities)
  // Set on AI-generated suggestions only. Their ingredients are plain text,
  // not HTML — callers must render them without dangerouslySetInnerHTML.
  isAi?: boolean;
}

export interface GeneratedMeal {
  spec: MealSpec;
  options: MealOption[]; // up to 3, best match first
}

export interface MealPlanContext {
  archetype: Archetype;
  bioScores: { strength: number; recovery: number; digestion: number; satiety: number };
  phase: Phase;
  dietaryRestrictions: string;
  favoriteFoods: string;
}

// Matches recipes for a meal slot (restrictions -> archetype -> anything),
// ranks favorites first, and generates the top 3 as fully-built options
// with real ingredient quantities for that meal's macro targets.
// `customRecipes` (Recipe Hub v2 — a coach's own submitted recipes,
// pre-converted to this same Recipe shape by lib/custom-recipes.ts) are
// pooled alongside the built-in RECIPE_DATABASE; nothing here needs to
// know the difference between the two once they're both in this shape.
export function generateMealOptions(
  spec: MealSpec,
  macros: MacroTargets,
  context: MealPlanContext,
  customRecipes: Recipe[] = []
): GeneratedMeal {
  // Custom recipes lead the pool — a coach who specifically built one
  // should see it win a slot over the generic built-ins, not get crowded
  // out by whichever 3 built-ins happen to match first.
  const recipePool = customRecipes.length > 0 ? [...customRecipes, ...RECIPE_DATABASE] : RECIPE_DATABASE;
  const isLowAppetite = context.bioScores.satiety <= 2;
  const isPoorDigestion = context.bioScores.digestion <= 2;
  const isHeavySurplus = context.phase === "hypertrophy" && macros.calories >= 3000;
  const enableLiquid = (isLowAppetite || isPoorDigestion || isHeavySurplus) && context.archetype !== "carnivore";

  const restrictionsText = (context.dietaryRestrictions || "").toLowerCase();
  const favText = (context.favoriteFoods || "").toLowerCase();
  const ARCHETYPE_LABELS = ["vegan", "plant-based", "carnivore", "keto", "paleo"];
  const bans = restrictionsText ? restrictionsText.split(/[,/]/).map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  const favs = favText ? favText.split(/[,/]/).map((s) => s.trim().toLowerCase()).filter(Boolean) : [];

  let matched = recipePool.filter((r) => {
    const slotMatch = r.slot === spec.slot || r.slot === "any";
    const archMatch = r.archetype.includes(context.archetype);
    if (!slotMatch || !archMatch) return false;
    const hasBan = bans.some((b) => {
      if (ARCHETYPE_LABELS.includes(b)) return false;
      return r.keywords.some((k) => k.includes(b) || b.includes(k));
    });
    return !hasBan;
  });

  if (matched.length === 0) {
    matched = recipePool.filter((r) => (r.slot === spec.slot || r.slot === "any") && r.archetype.includes(context.archetype));
  }
  if (matched.length === 0) {
    matched = recipePool.filter((r) => r.archetype.includes(context.archetype));
  }

  if (favs.length > 0) {
    matched = [...matched].sort((a, b) => {
      const aFav = favs.some((f) => a.keywords.some((k) => k.includes(f))) ? 1 : 0;
      const bFav = favs.some((f) => b.keywords.some((k) => k.includes(f))) ? 1 : 0;
      return bFav - aFav;
    });
  }

  const activeCat = FUNCTIONAL_CATEGORIES[spec.categoryIndex % FUNCTIONAL_CATEGORIES.length];
  const helperOptions: RecipeHelperOptions = {
    enableLiquid,
    produce: `<strong>Produce Profile (${activeCat.group}):</strong> 1-2 cups (${activeCat.produceOptions})`,
  };

  const options: MealOption[] = matched.slice(0, 3).map((recipe) => ({
    recipeId: recipe.id,
    recipeName: recipe.name,
    ingredients: recipe.build(spec.proteinTarget, spec.carbsTarget, spec.fatTarget, helperOptions),
  }));

  return { spec, options };
}

export function generateFullMealPlan(
  macros: MacroTargets,
  mealCount: number,
  includeSnack: boolean,
  context: MealPlanContext,
  customRecipes: Recipe[] = []
): GeneratedMeal[] {
  const specs = buildMealSpecs(macros, mealCount, includeSnack);
  return specs.map((spec) => generateMealOptions(spec, macros, context, customRecipes));
}

export const QUICK_SWAP_NOTES = [
  "Carb Swaps: 50g Dry Jasmine Rice ≈ 200g Raw Sweet Potato ≈ 60g Dry Oats ≈ 2.5 slices Sourdough Bread (~40g Net Carbs).",
  "Protein Swaps: 150g Raw Chicken Breast ≈ 165g Raw 93/7 Ground Turkey ≈ 160g Top Sirloin ≈ 150g Extra Firm Tofu + 1 scoop Pea Protein (~35g Protein).",
  "Fat Swaps: 1 tsp Olive/Avocado Oil (4.5g) ≈ 30g Fresh Avocado ≈ 9g Natural Almond/Peanut Butter ≈ 8g Tahini.",
];
