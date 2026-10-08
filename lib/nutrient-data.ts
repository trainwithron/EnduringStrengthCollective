import type { SupabaseClient } from "@supabase/supabase-js";
import { ageOnDate, asBiologicalSex } from "@/lib/nutrition-profile";
import { readDateOfBirth, rowToBodyProfile } from "@/lib/client-body-profile";
import { rowToPreferences } from "@/lib/nutrition-preferences";
import type { FoodRules } from "@/lib/allergen-check";
import type { LoggedEntry } from "@/lib/nutrient-day";
import type { Sex } from "@/lib/dri-data";
import { datesEndingOn } from "@/lib/nutrient-view";

// Everything the nutrient screens read for one client, with the signed-in person's own access (a client reads their own; a coach reads their clients' through the existing rules).
// Each read fails soft: a missing table or column (the database paste is pending) gives an empty log or an unknown age/sex, never an error page.

export const LOG_DAYS = 30;

export async function fetchNutrientLog(supabase: SupabaseClient, athleteId: string, todayKey: string): Promise<LoggedEntry[]> {
  const since = datesEndingOn(todayKey, LOG_DAYS)[0];
  const full = await supabase.from("food_log_entries").select("log_date, status, description, calories, nutrients").eq("athlete_id", athleteId).gte("log_date", since).lte("log_date", todayKey).limit(3000);
  if (!full.error) {
    return ((full.data ?? []) as { log_date: string; status: string | null; description: string | null; calories: number | string | null; nutrients: Record<string, number> | null }[]).map((r) => ({
      logDate: r.log_date,
      status: r.status,
      description: r.description,
      calories: r.calories == null ? null : Number(r.calories),
      nutrients: r.nutrients ?? null,
    }));
  }
  // The detail column is not in the database yet: the calories still count, no nutrient is reported.
  const base = await supabase.from("food_log_entries").select("log_date, status, description, calories").eq("athlete_id", athleteId).gte("log_date", since).lte("log_date", todayKey).limit(3000);
  return ((base.data ?? []) as { log_date: string; status: string | null; description: string | null; calories: number | string | null }[]).map((r) => ({
    logDate: r.log_date,
    status: r.status,
    description: r.description,
    calories: r.calories == null ? null : Number(r.calories),
    nutrients: null,
  }));
}

export async function fetchAgeAndSex(supabase: SupabaseClient, athleteId: string, todayKey: string): Promise<{ age: number | null; sex: Sex | null }> {
  const [{ data: details }, { data: intake }] = await Promise.all([
    supabase.from("athlete_profile_details").select("biological_sex, birthday").eq("athlete_id", athleteId).maybeSingle(),
    supabase.from("client_intake").select("date_of_birth").eq("athlete_id", athleteId).maybeSingle(),
  ]);
  const profile = rowToBodyProfile(details as Record<string, unknown> | null, intake as Record<string, unknown> | null);
  const dob = readDateOfBirth(profile);
  const age = dob ? ageOnDate(dob, todayKey) : null;
  return { age: age != null && age >= 0 && age <= 120 ? age : null, sex: asBiologicalSex(profile.sex) };
}

// The client's allergies and food rules, or null when they cannot be read (so no food ideas are suggested: it fails closed).
export async function fetchFoodRules(supabase: SupabaseClient, athleteId: string): Promise<FoodRules | null> {
  const { data, error } = await supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", athleteId).maybeSingle();
  if (error) return null;
  const p = rowToPreferences(data);
  return { allergies: p.allergies, intolerances: p.intolerances, dislikes: p.dislikes, dietType: p.dietType };
}
