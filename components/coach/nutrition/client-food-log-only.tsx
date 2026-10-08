import { createServerClient } from "@/lib/supabase/server";
import { buildFoodWeek, type FoodEntryRow } from "@/lib/food-week";
import { computeWeeklyWeightTrend } from "@/lib/weight-trend";
import { addDaysToKey } from "@/lib/date-key";
import { dateKeyInZone, getGroupCoachTimezone } from "@/lib/timezone";
import { asWeightUnit } from "@/lib/units";
import { WhatTheyAte } from "@/components/coach/nutrition/what-they-ate";
import { GROUP_TIER_COACH_NOTE } from "@/lib/nutrition-tracking";
import { FoodTrackingSwitch } from "@/components/coach/nutrition/food-tracking-switch";

// What a coach sees for a client whose tier has no targets or meal plans (the group tier): the client still logs what they eat, and the coach can see it. The rest of the
// Nutrition area (targets, preferences, meal plan, calculator) is the coach-run programming that this tier does not include.
export async function ClientFoodLogOnly({ athleteId, groupId, clientName }: { athleteId: string; groupId: string; clientName: string }) {
  const supabase = await createServerClient();
  const timezone = await getGroupCoachTimezone(supabase, groupId);
  const todayKey = dateKeyInZone(timezone);
  const weekStartKey = addDaysToKey(todayKey, -6);
  const [{ data: foodRows }, { data: weightLogs }, { data: unitRow }] = await Promise.all([
    supabase
      .from("food_log_entries")
      .select("log_date, meal_slot, status, description, calories, protein_g, carbs_g, fat_g")
      .eq("athlete_id", athleteId)
      .gte("log_date", weekStartKey),
    supabase.from("body_weight_logs").select("logged_date, weight").eq("athlete_id", athleteId).eq("group_id", groupId).order("logged_date", { ascending: false }).limit(60),
    supabase.from("athlete_profile_details").select("weight_unit").eq("athlete_id", athleteId).maybeSingle(),
  ]);
  const week = buildFoodWeek({ entries: (foodRows ?? []) as FoodEntryRow[], todayKey, targetFor: () => null });
  const weightTrend = computeWeeklyWeightTrend(
    (weightLogs ?? []).map((w) => ({ loggedDate: w.logged_date, weight: w.weight })),
    todayKey
  );
  const firstName = clientName.split(" ")[0] || "this client";
  return (
    <div className="space-y-4">
      <p className="font-body text-sm text-steel max-w-[70ch]">{GROUP_TIER_COACH_NOTE}</p>
      <FoodTrackingSwitch athleteId={athleteId} groupId={groupId} clientName={clientName} />
      <section>
        <h3 className="font-display uppercase text-sm tracking-wide text-steel mb-2">What they ate</h3>
        <WhatTheyAte week={week} weightTrend={weightTrend} clientName={firstName} weightUnit={asWeightUnit(unitRow?.weight_unit)} />
      </section>
    </div>
  );
}
