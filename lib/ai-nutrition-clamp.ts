import type { SupabaseClient } from "@supabase/supabase-js";

// What the AI may say about one meal or one recipe: believable numbers only. A model that answers 90000 calories or a negative number never reaches a log or a recipe.
export const MAX_MEAL_KCAL = 5000;
export const MAX_MEAL_GRAMS = 500;

const whole = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));

export function clampMealMacros(m: { calories: number; proteinG: number; carbsG: number; fatG: number }) {
  return { calories: whole(m.calories, MAX_MEAL_KCAL), proteinG: whole(m.proteinG, MAX_MEAL_GRAMS), carbsG: whole(m.carbsG, MAX_MEAL_GRAMS), fatG: whole(m.fatG, MAX_MEAL_GRAMS) };
}

// Food per 100 g: calories up to 900 (pure fat), each macro up to 100 g.
export function clampPer100g(m: { calories: number; proteinG: number; carbsG: number; fatG: number }) {
  return { calories: whole(m.calories, 900), proteinG: whole(m.proteinG, 100), carbsG: whole(m.carbsG, 100), fatG: whole(m.fatG, 100) };
}

// An AI call costs real money, so only a person who belongs to at least one group (as a client or a coach) can make one: a bare account cannot run up the platform's AI bill.
export async function userBelongsToAGroup(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("group_memberships").select("group_id").eq("profile_id", userId).limit(1);
  return !error && (data ?? []).length > 0;
}

// A standing rule or preference the coach teaches the builder is kept short on the way in and cut again on the way out, so one long paste can never swamp a later prompt.
export const MAX_RULE_TEXT = 300;
