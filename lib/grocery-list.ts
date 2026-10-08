import { UNIT_WEIGHT_G, toOz } from "@/lib/meal-templates";
import { choicesFeaturedFirst, mealRecipeChoices, type MealEntryPayload, type MealPlanBucket } from "@/lib/meal-plan-assignment";
import { isStructuredLine } from "@/lib/meal-line";
import { displayNameOfKey } from "@/lib/meal-swap";

// The grocery list, ported from Ron's Mix & Macros app (generateMasterGroceryList). It reads the SAVED plan: for each day, the option the client's card shows first in each meal
// (or every option, split evenly), adds up the structured lines across the week (swaps included, because a swap rewrites the line) and rounds the way the old app did: eggs to
// dozens, sourdough to loaves of 16 slices, liquid egg whites to 500 g cartons, rice and potatoes to bag sizes for a client who uses pounds, foods counted in pieces with their estimated
// weight, and large weights also in pounds and ounces. Lines that carry no amounts (a coach's own recipe, an AI option, a plan saved before amounts were kept) cannot be added up; they
// are listed by name so nothing is silently missing. Pure: no database, no network.

export type GroceryCategory = "proteins" | "starches" | "fats" | "dairy" | "produce";
export const CATEGORY_ORDER: GroceryCategory[] = ["proteins", "starches", "fats", "dairy", "produce"];
export const CATEGORY_LABEL: Record<GroceryCategory, string> = {
  proteins: "Proteins",
  starches: "Starches and grains",
  fats: "Fats and oils",
  dairy: "Dairy and liquids",
  produce: "Produce and veggies",
};

export interface PlanDay {
  date: string;
  carbCycling: boolean;
  meals: Record<string, MealEntryPayload[]>;
}

export interface GroceryOptions {
  // "featured": the option the client's card shows first in each meal, each day. "split": every option in each meal, each counted for an equal share of the days.
  mode?: "featured" | "split";
  // For a carb-cycling plan (a training-day menu and a rest-day menu): how many of the week's days are training days. Default 4.
  trainingDaysPerWeek?: number;
  // Metric clients get no ounces, pounds or bag sizes.
  metric?: boolean;
}

export interface GroceryItem {
  category: GroceryCategory;
  name: string;
  qty: number;
  unit: string;
  display: string;
}

export interface GroceryList {
  categories: { key: GroceryCategory; label: string; items: GroceryItem[] }[];
  // Foods in the plan whose amounts are not kept (so they could not be added up), by name.
  unstructured: string[];
  daysCounted: number;
}

// How much of a day each menu counts for. A day that has a daily menu counts it fully; a carb-cycling day counts its training menu for the training-day share of the week and its rest
// menu for the rest.
function bucketWeights(day: PlanDay, trainingDaysPerWeek: number): { bucket: MealPlanBucket; weight: number }[] {
  const has = (b: MealPlanBucket) => Array.isArray(day.meals[b]) && day.meals[b].length > 0;
  const out: { bucket: MealPlanBucket; weight: number }[] = [];
  if (has("daily")) out.push({ bucket: "daily", weight: 1 });
  if (has("train") && has("rest")) {
    const t = Math.min(7, Math.max(0, trainingDaysPerWeek)) / 7;
    out.push({ bucket: "train", weight: t }, { bucket: "rest", weight: 1 - t });
  } else if (has("train")) out.push({ bucket: "train", weight: 1 });
  else if (has("rest")) out.push({ bucket: "rest", weight: 1 });
  return out;
}

const SLICES_PER_LOAF = 16;
const BAG_SIZES_LBS = [5, 10, 15, 20, 25];
const G_PER_LB = 453.592;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

// The foods the bag-size rule applies to: rice and potatoes (the old app tested the printed name, so cream of rice counted too; a rice cake never does).
const BAG_FOOD_KEYS = new Set(["jasmine_rice_dry", "cream_of_rice_dry", "potato_russet_raw", "sweet_potato_raw"]);

// How one total reads on the list, by the old app's rules. The food key (when the line has one) decides which rule applies, so every name a food is printed under gets the same rule.
export function displayFor(name: string, qty: number, unit: string, metric: boolean, foodKey?: string): string {
  const lower = name.toLowerCase();
  const rounded = Math.round(qty);
  if (foodKey === "egg_whole_large" || name.includes("Whole Eggs")) {
    const dozens = Math.max(1, Math.ceil(qty / 12));
    return `${rounded} large (~${dozens} dozen, ~${Math.round(qty * UNIT_WEIGHT_G.large)}g)`;
  }
  if ((foodKey === "egg_whites_liquid" || lower.includes("egg whites")) && qty > 0) return `${rounded}g (~${Math.ceil(qty / 500)}x 500g cartons)`;
  if ((foodKey === "sourdough_slice" || name === "Sourdough Bread") && unit === "slices") {
    const loaves = Math.max(1, Math.ceil(qty / SLICES_PER_LOAF));
    return `${loaves} ${plural(loaves, "loaf", "loaves")} (~${rounded} slices needed, ~${Math.round(qty * UNIT_WEIGHT_G.slices)}g)`;
  }
  const bagFood = foodKey ? BAG_FOOD_KEYS.has(foodKey) : lower.includes("potato") || (lower.includes("rice") && !lower.includes("rice cake") && !lower.includes("pasta"));
  if (unit === "g" && !metric && bagFood) {
    const lbs = qty / G_PER_LB;
    const maxBag = BAG_SIZES_LBS[BAG_SIZES_LBS.length - 1];
    const bag = lbs <= maxBag ? `${BAG_SIZES_LBS.find((s) => s >= lbs)} lb bag` : `${Math.ceil(lbs / maxBag)}x ${maxBag} lb bags`;
    return `${rounded}g ${toOz(qty)} → ${bag}`;
  }
  if (unit !== "g" && (UNIT_WEIGHT_G as Record<string, number>)[unit]) {
    return `${rounded} ${unit} (~${Math.round(qty * (UNIT_WEIGHT_G as Record<string, number>)[unit])}g)`;
  }
  if (unit === "g") {
    let s = metric ? `${rounded}g` : `${rounded}g ${toOz(qty)}`;
    if (!metric) {
      const oz = qty / 28.3495;
      if (oz > 16) {
        const lbs = Math.floor(oz / 16);
        s += ` (${lbs} lb ${(oz - lbs * 16).toFixed(1)} oz)`;
      }
    }
    return s;
  }
  return `${rounded} ${unit}`;
}

export function compileGroceryList(days: PlanDay[], opts: GroceryOptions = {}): GroceryList {
  const mode = opts.mode ?? "featured";
  const metric = !!opts.metric;
  const trainingDays = opts.trainingDaysPerWeek ?? 4;
  const totals = new Map<string, { category: GroceryCategory; name: string; foodKey: string; qty: number; unit: string }>();
  const unstructured = new Set<string>();
  let daysCounted = 0;

  for (const day of days) {
    const weights = bucketWeights(day, trainingDays);
    if (weights.length === 0) continue;
    daysCounted += 1;
    for (const { bucket, weight } of weights) {
      for (const entry of day.meals[bucket] ?? []) {
        const choices = mode === "featured" ? choicesFeaturedFirst(entry).slice(0, 1) : mealRecipeChoices(entry);
        const share = weight / Math.max(1, choices.length);
        for (const choice of choices) {
          for (const line of choice.lines ?? []) {
            if (isStructuredLine(line) && line.category in CATEGORY_LABEL) {
              // One row per FOOD, not per printed name: "Whole Eggs" and "Hard-Boiled Eggs" are the same food, and a swap names its line with the food's first name.
              const key = `${line.foodKey}|${line.unit}`;
              const cur = totals.get(key) ?? { category: line.category as GroceryCategory, name: displayNameOfKey(line.foodKey), foodKey: line.foodKey, qty: 0, unit: line.unit };
              cur.qty += line.qty * share;
              totals.set(key, cur);
            } else if (line.name) unstructured.add(line.name);
          }
          // A choice with no lines at all (an older plan) is listed by its ingredient text so it is not lost.
          if (!choice.lines || choice.lines.length === 0) for (const s of choice.ingredients ?? []) {
            const text = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            if (text && /\d/.test(text)) unstructured.add(text.replace(/:.*$/, "").trim() || text);
          }
        }
      }
    }
  }

  const categories = CATEGORY_ORDER.map((key) => ({
    key,
    label: CATEGORY_LABEL[key],
    items: [...totals.values()]
      .filter((t) => t.category === key && t.qty > 0)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ category: key, name: t.name, qty: t.qty, unit: t.unit, display: displayFor(t.name, t.qty, t.unit, metric, t.foodKey) })),
  })).filter((c) => c.items.length > 0);
  return { categories, unstructured: [...unstructured].sort((a, b) => a.localeCompare(b)), daysCounted };
}

// The list as plain text, for copying into a note or a message.
export function groceryListText(list: GroceryList, title = "GROCERY LIST"): string {
  const lines = [title, ""];
  for (const c of list.categories) {
    lines.push(c.label.toUpperCase());
    for (const i of c.items) lines.push(`  ${i.name}: ${i.display}`);
    lines.push("");
  }
  if (list.unstructured.length > 0) {
    lines.push("ALSO IN THE PLAN (amounts not kept, check the plan)");
    for (const n of list.unstructured) lines.push(`  ${n}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
