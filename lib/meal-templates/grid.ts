// The spread of slot targets the permanent diagnostics test (and the port log) builds every recipe at. A realistic day is 3 to 5 meals of a 1,600 to 3,500 calorie
// plan, so a slot runs from about 15 g of protein (a small snack) to 100 g (a big dinner). The SHAPE of a target depends on the client's diet, carb split and protein
// rule (a coach can set protein up to 1.5 g per pound), so each shape is its own family:
//   standard      an everyday plan (omnivore, vegetarian, vegan, paleo, pescatarian) on the balanced split
//   low_carb      the same diets on the low carb split (more fat, fewer carbs)
//   high_carb     the same diets on the high carb split (more carbs, less fat)
//   high_protein  a cutting client or a high protein rule: about half of the calories from protein
//   light         a small-calorie plan (about 1,300 to 1,600 a day): modest protein, little fat
//   keto          fat-led, a few grams of carbs
//   carnivore     no carbs, fat about equal to protein
import type { DietType, Slot } from "./types";
import type { SlotTarget } from "./tolerance";

export type TargetFamily = "standard" | "low_carb" | "high_carb" | "high_protein" | "light" | "keto" | "carnivore";
export const FAMILIES: TargetFamily[] = ["standard", "low_carb", "high_carb", "high_protein", "light", "keto", "carnivore"];

export const BASE_TARGETS: Record<TargetFamily, Record<Slot, SlotTarget>> = {
  standard: {
    breakfast: { proteinG: 40, carbsG: 60, fatG: 15 },
    lunch: { proteinG: 50, carbsG: 70, fatG: 18 },
    dinner: { proteinG: 50, carbsG: 60, fatG: 20 },
    snack: { proteinG: 25, carbsG: 25, fatG: 8 },
  },
  low_carb: {
    breakfast: { proteinG: 40, carbsG: 30, fatG: 27 },
    lunch: { proteinG: 50, carbsG: 35, fatG: 32 },
    dinner: { proteinG: 50, carbsG: 30, fatG: 34 },
    snack: { proteinG: 25, carbsG: 12, fatG: 15 },
  },
  high_carb: {
    breakfast: { proteinG: 40, carbsG: 80, fatG: 10 },
    lunch: { proteinG: 50, carbsG: 90, fatG: 12 },
    dinner: { proteinG: 50, carbsG: 80, fatG: 14 },
    snack: { proteinG: 25, carbsG: 35, fatG: 5 },
  },
  high_protein: {
    breakfast: { proteinG: 50, carbsG: 30, fatG: 9 },
    lunch: { proteinG: 60, carbsG: 35, fatG: 10 },
    dinner: { proteinG: 60, carbsG: 30, fatG: 12 },
    snack: { proteinG: 35, carbsG: 15, fatG: 4 },
  },
  light: {
    breakfast: { proteinG: 28, carbsG: 30, fatG: 7 },
    lunch: { proteinG: 32, carbsG: 35, fatG: 9 },
    dinner: { proteinG: 32, carbsG: 30, fatG: 10 },
    snack: { proteinG: 15, carbsG: 15, fatG: 4 },
  },
  keto: {
    breakfast: { proteinG: 40, carbsG: 6, fatG: 45 },
    lunch: { proteinG: 50, carbsG: 8, fatG: 55 },
    dinner: { proteinG: 50, carbsG: 8, fatG: 55 },
    snack: { proteinG: 25, carbsG: 4, fatG: 28 },
  },
  carnivore: {
    breakfast: { proteinG: 40, carbsG: 0, fatG: 40 },
    lunch: { proteinG: 50, carbsG: 0, fatG: 50 },
    dinner: { proteinG: 50, carbsG: 0, fatG: 50 },
    snack: { proteinG: 25, carbsG: 0, fatG: 25 },
  },
};

// Multipliers applied to a base: a small meal to a big one.
export const SCALES = [0.6, 0.8, 1, 1.25, 1.6, 2];

const EVERYDAY: TargetFamily[] = ["standard", "low_carb", "high_carb", "high_protein", "light"];

// The target shapes a diet is served on.
export const familiesOfDiet = (diet: DietType): TargetFamily[] => (diet === "keto" ? ["keto"] : diet === "carnivore" ? ["carnivore"] : EVERYDAY);

// Every shape any of a recipe's declared diets is served on.
export const familiesOf = (archetypes: DietType[]): TargetFamily[] => FAMILIES.filter((f) => archetypes.some((a) => familiesOfDiet(a).includes(f)));

export function gridFor(family: TargetFamily, slot: Slot): SlotTarget[] {
  const b = BASE_TARGETS[family][slot];
  return SCALES.map((s) => ({ proteinG: Math.round(b.proteinG * s), carbsG: Math.round(b.carbsG * s), fatG: Math.round(b.fatG * s) }));
}
