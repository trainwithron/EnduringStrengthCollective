import { createServerClient } from "@/lib/supabase/server";
import { addDaysToKey } from "@/lib/date-key";
import { GroceryListPanel } from "@/components/coach/nutrition/grocery-list-panel";
import type { PlanDay } from "@/lib/grocery-list";
import type { MealEntryPayload } from "@/lib/meal-plan-assignment";

// Reads the next seven days of one client's saved meal plan and hands them to the grocery list. Server-fed: the plan rows are read with the signed-in coach's access.
export async function GroceryListSection({ athleteId, todayKey, clientName, metric }: { athleteId: string; todayKey: string; clientName: string; metric: boolean }) {
  const supabase = await createServerClient();
  const endKey = addDaysToKey(todayKey, 6);
  const { data, error } = await supabase.from("meal_plans").select("log_date, carb_cycling, meals").eq("athlete_id", athleteId).gte("log_date", todayKey).lte("log_date", endKey).order("log_date", { ascending: true });
  if (error) {
    return <p className="font-body text-sm text-steel border border-steel/20 p-4">The grocery list could not be read just now. Reload the page to try again.</p>;
  }
  const days: PlanDay[] = ((data ?? []) as { log_date: string; carb_cycling: boolean | null; meals: unknown }[])
    .filter((r) => r.meals && typeof r.meals === "object" && !Array.isArray(r.meals))
    .map((r) => ({ date: r.log_date, carbCycling: !!r.carb_cycling, meals: r.meals as Record<string, MealEntryPayload[]> }));
  return <GroceryListPanel days={days} clientName={clientName} metric={metric} />;
}
