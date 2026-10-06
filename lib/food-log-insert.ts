import type { SupabaseClient } from "@supabase/supabase-js";
import type { FoodLogEntry } from "@/components/athlete/meal-checkoff-list";

// The one place a food log entry is written from a tap (a recent, a favorite). The AI estimate, barcode and photo flows write the same table in their own
// components; this keeps the repeat-a-food paths identical so they cannot drift.
export interface NewFoodLog {
  athleteId: string;
  groupId: string;
  logDate: string;
  mealSlot?: string | null;
  status?: "quick_log" | "modified";
  description: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export async function insertFoodLogEntry(supabase: SupabaseClient, input: NewFoodLog): Promise<FoodLogEntry | null> {
  const status = input.status ?? "quick_log";
  const mealSlot = input.mealSlot ?? null;
  const { data, error } = await supabase
    .from("food_log_entries")
    .insert({
      athlete_id: input.athleteId,
      group_id: input.groupId,
      log_date: input.logDate,
      meal_slot: mealSlot,
      status,
      description: input.description,
      calories: input.calories,
      protein_g: input.proteinG,
      carbs_g: input.carbsG,
      fat_g: input.fatG,
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return {
    id: data.id as string,
    mealSlot,
    status,
    description: input.description,
    calories: input.calories,
    proteinG: input.proteinG,
    carbsG: input.carbsG,
    fatG: input.fatG,
  };
}
