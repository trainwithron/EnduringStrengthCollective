import type { SupabaseClient } from "@supabase/supabase-js";
import { ageOnDate, asBiologicalSex } from "@/lib/nutrition-profile";
import { readDateOfBirth, rowToBodyProfile } from "@/lib/client-body-profile";
import { rowToPreferences } from "@/lib/nutrition-preferences";
import type { FoodRules } from "@/lib/allergen-check";
import type { LoggedEntry } from "@/lib/nutrient-day";
import type { Sex } from "@/lib/dri-data";
import { datesEndingOn } from "@/lib/nutrient-view";
import { pageAll } from "@/lib/page-all";

// Everything the nutrient screens read for one client, with the signed-in person's own access (a client reads their own; a coach reads their clients' through the existing rules).
// Each read fails soft: a missing table or column (the database paste is pending) gives an empty log or an unknown age/sex, never an error page.

export const LOG_DAYS = 30;

export interface NutrientLog {
  entries: LoggedEntry[];
  // True when the log was longer than the reader allows (or a page failed), so the figures are based on part of it. Shown to the person; never silently dropped.
  truncated: boolean;
}

type Row = { log_date: string; status: string | null; description: string | null; calories: number | string | null; nutrients?: Record<string, number> | null };
const toEntry = (r: Row): LoggedEntry => ({ logDate: r.log_date, status: r.status, description: r.description, calories: r.calories == null ? null : Number(r.calories), nutrients: r.nutrients ?? null });

// The last 30 days of one client's log. A request returns at most 1,000 rows however many are asked for, and a heavy logger (a saved meal is one row per food) passes that in a month,
// so this reads page by page in a fixed order (date, then id) and says so if it still could not read it all.
export async function fetchNutrientLog(supabase: SupabaseClient, athleteId: string, todayKey: string): Promise<NutrientLog> {
  const since = datesEndingOn(todayKey, LOG_DAYS)[0];
  const read = (columns: string) =>
    pageAll((from, to) =>
      supabase.from("food_log_entries").select(columns).eq("athlete_id", athleteId).gte("log_date", since).lte("log_date", todayKey).order("log_date", { ascending: true }).order("id", { ascending: true }).range(from, to)
    );
  const full = await read("log_date, status, description, calories, nutrients");
  if (!full.failed) return { entries: (full.rows as Row[]).map(toEntry), truncated: full.truncated };
  // A page failed AFTER some rows were read (a passing error on a later page): keep what was read, detail and all, and say it is partial. Dropping the detail of the whole log for one
  // failed page would make every nutrient read "not reported".
  if (full.rows.length > 0) return { entries: (full.rows as Row[]).map(toEntry), truncated: true };
  // The very first page failed: the detail column is probably not in the database yet. Try without it; the calories still count, no nutrient is reported.
  const base = await read("log_date, status, description, calories");
  return { entries: (base.rows as Row[]).map((r) => toEntry({ ...r, nutrients: null })), truncated: base.truncated || base.failed };
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
