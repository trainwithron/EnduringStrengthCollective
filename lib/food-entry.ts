import type { SupabaseClient } from "@supabase/supabase-js";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";
import { macrosOf, scaleNutrients, per100gFromSnapshot, MAX_AMOUNT_G, type NutrientMap } from "@/lib/food-serving";

// Writing, changing, copying and removing food log entries for the food search (and, from phase 2, custom foods and saved meals). Every write is the signed-in client's own
// (row security: a client writes only their own log); the pure builders are tested without a database.

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const MEAL_SLOT_LABEL: Record<MealSlot, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };

// Which meal a new entry starts on, by the hour of the day in the client's own time: before 10:30 breakfast, to 14:30 lunch, to 17:00 a snack, to 21:30 dinner, then a snack.
export function defaultMealSlot(hour: number, minute = 0): MealSlot {
  const t = hour * 60 + minute;
  if (t < 10 * 60 + 30) return "breakfast";
  if (t < 14 * 60 + 30) return "lunch";
  if (t < 17 * 60) return "snack";
  if (t < 21 * 60 + 30) return "dinner";
  return "snack";
}

// Every column of an entry the client's pages read, including the searched-food detail from migration 0300. Before that migration is applied the detail columns do not exist
// and the read falls back to the original columns (FOOD_LOG_BASE_SELECT), so nothing breaks while the paste is pending.
export const FOOD_LOG_BASE_SELECT = "id, meal_slot, status, description, calories, protein_g, carbs_g, fat_g";
export const FOOD_LOG_DETAIL_SELECT = `${FOOD_LOG_BASE_SELECT}, food_source, fdc_id, amount_g, serving_label, serving_qty, nutrients, barcode`;

export interface FoodLogRow {
  id: string;
  meal_slot: string | null;
  status: string;
  description: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  food_source?: string | null;
  fdc_id?: number | null;
  amount_g?: number | null;
  serving_label?: string | null;
  serving_qty?: number | null;
  nutrients?: NutrientMap | null;
  barcode?: string | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

export function entryFromRow(r: FoodLogRow): FoodLogEntry {
  return {
    id: r.id,
    mealSlot: r.meal_slot,
    status: r.status as FoodLogEntry["status"],
    description: r.description,
    calories: num(r.calories),
    proteinG: num(r.protein_g),
    carbsG: num(r.carbs_g),
    fatG: num(r.fat_g),
    foodSource: r.food_source ?? null,
    fdcId: r.fdc_id ?? null,
    amountG: num(r.amount_g),
    servingLabel: r.serving_label ?? null,
    servingQty: num(r.serving_qty),
    nutrients: r.nutrients ?? null,
    barcode: r.barcode ?? null,
  };
}

// Reads a day's entries with the detail columns, falling back to the original columns when the database does not have them yet.
export async function fetchFoodLogDay(supabase: SupabaseClient, athleteId: string, logDate: string): Promise<FoodLogEntry[]> {
  const detail = await supabase.from("food_log_entries").select(FOOD_LOG_DETAIL_SELECT).eq("athlete_id", athleteId).eq("log_date", logDate).order("created_at", { ascending: true });
  if (!detail.error) return ((detail.data ?? []) as unknown as FoodLogRow[]).map(entryFromRow);
  const base = await supabase.from("food_log_entries").select(FOOD_LOG_BASE_SELECT).eq("athlete_id", athleteId).eq("log_date", logDate).order("created_at", { ascending: true });
  return ((base.data ?? []) as unknown as FoodLogRow[]).map(entryFromRow);
}

export interface UsdaEntryInput {
  athleteId: string;
  groupId: string;
  logDate: string;
  mealSlot: MealSlot | null;
  fdcId: number;
  description: string;
  servingLabel: string;
  servingQty: number;
  grams: number;
  per100g: NutrientMap;
}

const MAX_DESCRIPTION = 160;
export const trimDescription = (d: string): string => (d.length > MAX_DESCRIPTION ? `${d.slice(0, MAX_DESCRIPTION - 1)}…` : d);

// The row inserted for a searched USDA food: calories and macros for the amount, plus the amount, the serving as shown and a snapshot of every nutrient the food reports.
export function usdaEntryRow(input: UsdaEntryInput) {
  const nutrients = scaleNutrients(input.per100g, input.grams);
  const m = macrosOf(nutrients);
  return {
    athlete_id: input.athleteId,
    group_id: input.groupId,
    log_date: input.logDate,
    meal_slot: input.mealSlot,
    status: "quick_log" as const,
    description: trimDescription(input.description),
    calories: m.calories,
    protein_g: m.proteinG,
    carbs_g: m.carbsG,
    fat_g: m.fatG,
    food_source: "usda" as const,
    fdc_id: input.fdcId,
    amount_g: input.grams,
    serving_label: input.servingLabel,
    serving_qty: input.servingQty,
    nutrients,
  };
}

export async function insertUsdaEntry(supabase: SupabaseClient, input: UsdaEntryInput): Promise<FoodLogEntry | null> {
  const { data, error } = await supabase.from("food_log_entries").insert(usdaEntryRow(input)).select(FOOD_LOG_DETAIL_SELECT).single();
  if (error || !data) return null;
  return entryFromRow(data as unknown as FoodLogRow);
}

// A different amount of the same logged food: the calories, macros and every nutrient are re-scaled from the stored snapshot (no lookup), keeping the serving as logged.
export function rescaleEntryPatch(entry: FoodLogEntry, newQty: number): { amount_g: number; serving_qty: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; nutrients: NutrientMap } | null {
  if (!entry.nutrients || !entry.amountG || !entry.servingQty || !(newQty > 0)) return null;
  const gramsPerServing = entry.amountG / entry.servingQty;
  const grams = Math.round(gramsPerServing * newQty * 10) / 10;
  if (!(grams > 0) || grams > MAX_AMOUNT_G) return null;
  const nutrients = scaleNutrients(per100gFromSnapshot(entry.nutrients, entry.amountG), grams);
  const m = macrosOf(nutrients);
  return { amount_g: grams, serving_qty: newQty, calories: m.calories, protein_g: m.proteinG, carbs_g: m.carbsG, fat_g: m.fatG, nutrients };
}

export async function updateEntry(supabase: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error } = await supabase.from("food_log_entries").update(patch).eq("id", id);
  return !error;
}

export async function deleteEntry(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("food_log_entries").delete().eq("id", id);
  return !error;
}

// Rows to copy entries to another day (and optionally to another meal). A copy is always a plain logged food: a planned meal that was ticked off or skipped is not copied as such.
export function copyRows(entries: FoodLogEntry[], opts: { athleteId: string; groupId: string; toDate: string; mealSlot?: MealSlot | null }): Record<string, unknown>[] {
  return entries
    .filter((e) => e.status !== "skipped" && (e.calories != null || e.description))
    .map((e) => {
      const row: Record<string, unknown> = {
        athlete_id: opts.athleteId,
        group_id: opts.groupId,
        log_date: opts.toDate,
        meal_slot: opts.mealSlot !== undefined ? opts.mealSlot : e.mealSlot,
        status: "quick_log",
        description: e.description,
        calories: e.calories,
        protein_g: e.proteinG,
        carbs_g: e.carbsG,
        fat_g: e.fatG,
      };
      // The searched-food detail goes along only when the entry has it, so copying an entry logged the old way writes exactly the old columns.
      const detail: Record<string, unknown> = {
        food_source: e.foodSource,
        fdc_id: e.fdcId,
        amount_g: e.amountG,
        serving_label: e.servingLabel,
        serving_qty: e.servingQty,
        nutrients: e.nutrients,
        barcode: e.barcode,
      };
      for (const [k, v] of Object.entries(detail)) if (v != null) row[k] = v;
      return row;
    });
}

export async function insertCopies(supabase: SupabaseClient, rows: Record<string, unknown>[]): Promise<FoodLogEntry[] | null> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase.from("food_log_entries").insert(rows).select(FOOD_LOG_DETAIL_SELECT);
  if (error || !data) return null;
  return (data as unknown as FoodLogRow[]).map(entryFromRow);
}
