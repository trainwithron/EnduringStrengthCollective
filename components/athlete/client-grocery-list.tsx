import { createServerClient } from "@/lib/supabase/server";
import { addDaysToKey } from "@/lib/date-key";
import { GroceryListPanel } from "@/components/coach/nutrition/grocery-list-panel";
import { clientGroceryDays, type ClientGroceryRules } from "@/lib/client-grocery";

// The client's own grocery list (Release B4): the next seven days of THEIR saved meal plan, added up and rounded to what a person buys. It is built from the plan exactly as the client is shown it: an option that
// breaks their food rules is left out, and if their rules could not be read nothing is listed (the same fail-closed rule as the plan itself). With no saved plan the section is simply not there.
export async function ClientGroceryList({ athleteId, todayKey, metric, rules }: { athleteId: string; todayKey: string; metric: boolean; rules: ClientGroceryRules }) {
  const supabase = await createServerClient();
  const endKey = addDaysToKey(todayKey, 6);
  const { data, error } = await supabase.from("meal_plans").select("log_date, carb_cycling, meals").eq("athlete_id", athleteId).gte("log_date", todayKey).lte("log_date", endKey).order("log_date", { ascending: true });
  if (error) {
    return <p className="font-body text-sm text-steel border border-steel/20 p-4">Your grocery list could not be read just now. Reload the page to try again.</p>;
  }
  const days = clientGroceryDays((data ?? []) as { log_date: string; carb_cycling: boolean | null; meals: unknown }[], rules);
  if (days === null) {
    return <p className="font-body text-sm text-steel border border-steel/20 p-4">Your grocery list isn&apos;t available right now. Your coach is updating your meals.</p>;
  }
  if (days.length === 0) return null;
  return (
    <section aria-label="Your grocery list">
      <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">Your grocery list</h2>
      <GroceryListPanel days={days} clientName="you" metric={metric} audience="client" />
    </section>
  );
}
