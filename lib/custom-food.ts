import { checkMacros, parseNumberField, type MacroCheck } from "@/lib/food-validation";
import { macrosOf, MAX_AMOUNT_G, type NutrientMap } from "@/lib/food-serving";
import { trimDescription, type MealSlot } from "@/lib/food-entry";

// A food the client adds themselves: a protein bar, a restaurant dish, a family recipe. The numbers are PER SERVING, as printed on a label, plus an optional full label.
// Private to the client and readable by their coaches. Validation here matches the database limits (0302) and adds the warnings the database cannot (4/4/9, sugar above carbs).

// The label fields a person may fill in, with the largest sensible value per serving. Keys are the same names the USDA nutrients use (lib/nutrient-keys.ts), so a custom food's
// label and a USDA food's record add up together.
export interface LabelField {
  key: string;
  label: string;
  unit: string;
  max: number;
}
export const LABEL_FIELDS: LabelField[] = [
  { key: "fiber_g", label: "Fiber", unit: "g", max: 200 },
  { key: "sugar_g", label: "Sugar", unit: "g", max: 1000 },
  { key: "sat_fat_g", label: "Saturated fat", unit: "g", max: 500 },
  { key: "cholesterol_mg", label: "Cholesterol", unit: "mg", max: 10000 },
  { key: "sodium_mg", label: "Sodium", unit: "mg", max: 20000 },
  { key: "potassium_mg", label: "Potassium", unit: "mg", max: 20000 },
  { key: "calcium_mg", label: "Calcium", unit: "mg", max: 10000 },
  { key: "iron_mg", label: "Iron", unit: "mg", max: 500 },
  { key: "vitamin_d_mcg", label: "Vitamin D", unit: "mcg", max: 1000 },
];

export interface CustomFoodForm {
  name: string;
  brand: string;
  servingLabel: string;
  servingG: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  // key -> typed text, for the optional label fields
  label: Record<string, string>;
  barcode: string;
}

export const emptyCustomFoodForm = (barcode = ""): CustomFoodForm => ({ name: "", brand: "", servingLabel: "1 serving", servingG: "", calories: "", protein: "", carbs: "", fat: "", label: {}, barcode });

export interface CustomFood {
  id: string;
  name: string;
  brand: string | null;
  servingLabel: string;
  servingG: number | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  // Per serving, optional.
  nutrients: NutrientMap | null;
  barcode: string | null;
}

export interface CustomFoodCheck extends MacroCheck {
  // The row to insert when there are no errors.
  value: Omit<CustomFood, "id"> | null;
}

const num = (text: string): number | null => parseNumberField(text);

export function checkCustomFood(form: CustomFoodForm): CustomFoodCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = form.name.trim();
  if (name === "") errors.push("Give the food a name.");
  if (name.length > 120) errors.push("The name is too long (120 characters at most).");
  if (form.brand.trim().length > 80) errors.push("The brand is too long (80 characters at most).");
  const servingLabel = form.servingLabel.trim();
  if (servingLabel === "") errors.push("Say what one serving is, for example \"1 bar\" or \"1 cup\".");
  if (servingLabel.length > 80) errors.push("The serving description is too long.");

  const servingG = num(form.servingG);
  if (servingG != null && (Number.isNaN(servingG) || servingG <= 0 || servingG > 5000)) errors.push("The serving weight must be between 0 and 5,000 g, or left empty.");

  const calories = num(form.calories);
  const protein = num(form.protein);
  const carbs = num(form.carbs);
  const fat = num(form.fat);
  for (const [v, label] of [[calories, "Calories"], [protein, "Protein"], [carbs, "Carbs"], [fat, "Fat"]] as const) {
    if (v != null && Number.isNaN(v)) errors.push(`${label}: use numbers only.`);
  }
  if (errors.length === 0) {
    const m = checkMacros({ calories, proteinG: protein ?? 0, carbsG: carbs ?? 0, fatG: fat ?? 0 });
    errors.push(...m.errors);
    warnings.push(...m.warnings);
  }

  const label: NutrientMap = {};
  for (const f of LABEL_FIELDS) {
    const v = num(form.label[f.key] ?? "");
    if (v == null) continue;
    if (Number.isNaN(v)) errors.push(`${f.label}: use numbers only.`);
    else if (v < 0) errors.push(`${f.label} can't be negative.`);
    else if (v > f.max) errors.push(`${f.label} is more than ${f.max.toLocaleString("en-US")} ${f.unit} in one serving. Check the number.`);
    else label[f.key] = v;
  }
  if (errors.length === 0) {
    if ((label.sat_fat_g ?? 0) > (fat ?? 0) + 0.5) warnings.push("Saturated fat is more than the total fat. Check the label.");
    if ((label.sugar_g ?? 0) > (carbs ?? 0) + 0.5) warnings.push("Sugar is more than the total carbs. Check the label.");
    if ((label.fiber_g ?? 0) > (carbs ?? 0) + 0.5) warnings.push("Fiber is more than the total carbs. Check the label.");
  }

  const barcode = form.barcode.trim();
  if (barcode !== "" && !/^\d{6,32}$/.test(barcode)) errors.push("A barcode is numbers only, 6 to 32 digits.");

  if (errors.length > 0) return { errors, warnings, value: null };
  const nutrients: NutrientMap = { ...label };
  return {
    errors,
    warnings,
    value: {
      name,
      brand: form.brand.trim() || null,
      servingLabel,
      servingG: servingG ?? null,
      calories: calories as number,
      proteinG: protein ?? 0,
      carbsG: carbs ?? 0,
      fatG: fat ?? 0,
      nutrients: Object.keys(nutrients).length > 0 ? nutrients : null,
      barcode: barcode || null,
    },
  };
}

export function customFoodInsertRow(athleteId: string, food: Omit<CustomFood, "id">) {
  return {
    athlete_id: athleteId,
    name: food.name,
    brand: food.brand,
    serving_label: food.servingLabel,
    serving_g: food.servingG,
    calories: food.calories,
    protein_g: food.proteinG,
    carbs_g: food.carbsG,
    fat_g: food.fatG,
    nutrients: food.nutrients,
    barcode: food.barcode,
  };
}

export interface CustomFoodRow {
  id: string;
  name: string;
  brand: string | null;
  serving_label: string;
  serving_g: number | string | null;
  calories: number | string;
  protein_g: number | string;
  carbs_g: number | string;
  fat_g: number | string;
  nutrients: NutrientMap | null;
  barcode: string | null;
}
export const CUSTOM_FOOD_SELECT = "id, name, brand, serving_label, serving_g, calories, protein_g, carbs_g, fat_g, nutrients, barcode";

export function customFoodFromRow(r: CustomFoodRow): CustomFood {
  return {
    id: r.id,
    name: r.name,
    brand: r.brand,
    servingLabel: r.serving_label,
    servingG: r.serving_g == null ? null : Number(r.serving_g),
    calories: Number(r.calories),
    proteinG: Number(r.protein_g),
    carbsG: Number(r.carbs_g),
    fatG: Number(r.fat_g),
    nutrients: r.nutrients ?? null,
    barcode: r.barcode,
  };
}

export const customFoodTitle = (f: Pick<CustomFood, "name" | "brand">): string => (f.brand && !f.name.toLowerCase().includes(f.brand.toLowerCase()) ? `${f.brand} ${f.name}` : f.name);

// All the nutrients of one serving: the label fields plus the four macros, under the same keys the USDA nutrients use.
export function perServingNutrients(f: CustomFood): NutrientMap {
  return { ...(f.nutrients ?? {}), kcal: f.calories, protein_g: f.proteinG, carbs_g: f.carbsG, fat_g: f.fatG };
}

export function servingsProblem(qty: number): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return "Enter an amount greater than zero.";
  if (qty > 100) return "That is more than 100 servings. Check the amount.";
  return null;
}

// The food log row for logging `qty` servings of a custom food.
export function customFoodEntryRow(args: { athleteId: string; groupId: string; logDate: string; mealSlot: MealSlot | null; food: CustomFood; qty: number }) {
  const { food, qty } = args;
  // Every per-serving number times the number of servings.
  const scaled: NutrientMap = Object.fromEntries(Object.entries(perServingNutrients(food)).map(([k, v]) => [k, Math.round(v * qty * 1000) / 1000]));
  const m = macrosOf(scaled);
  const amountG = food.servingG != null ? Math.round(food.servingG * qty * 10) / 10 : null;
  return {
    athlete_id: args.athleteId,
    group_id: args.groupId,
    log_date: args.logDate,
    meal_slot: args.mealSlot,
    status: "quick_log" as const,
    description: trimDescription(customFoodTitle(food)),
    calories: Math.round(food.calories * qty),
    protein_g: m.proteinG,
    carbs_g: m.carbsG,
    fat_g: m.fatG,
    food_source: "custom" as const,
    amount_g: amountG != null && amountG > 0 && amountG <= MAX_AMOUNT_G ? amountG : null,
    serving_label: food.servingLabel,
    serving_qty: qty,
    nutrients: scaled,
    barcode: food.barcode,
  };
}
