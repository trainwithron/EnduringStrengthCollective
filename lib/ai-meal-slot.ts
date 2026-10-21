import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude, extractJson } from "@/lib/anthropic-client";
import type { AiCallMeta } from "@/lib/ai-usage";
import { verifyMealOptions, type RawMealOption, type VerifiedMealOption } from "@/lib/meal-option-verification";
import { checkMealOptions } from "@/lib/meal-option-pipeline";
import { rulesForPrompt } from "@/lib/plan-preference-check";
import type { FoodRules } from "@/lib/allergen-check";
import type { MealRecipeChoice } from "@/lib/meal-plan-assignment";

// The Nutrition Spot's one-meal suggestion, shared by the coach's planner (app/api/ai/generate-meal-plan) and the automatic allergy rebuild (app/api/nutrition/allergy-rebuild): the model is
// told the client's rules and the meal's target, and NOTHING it returns is trusted as-is. Every option's lines are matched to real food data and recomputed (lib/meal-option-verification.ts),
// then checked against the client's rules and the target (lib/meal-option-pipeline.ts). Throws what callClaude throws (not configured, the coach's AI budget or a limit reached).
export const MEAL_SLOT_SYSTEM_PROMPT = `You are a nutrition coach building three real, appetizing meal options for one meal
slot, each landing close to the same macro target. Respond with ONLY a JSON object shaped exactly like
this, no other text and no markdown code fence:

{
  "options": [
    { "recipeName": string, "ingredients": string[] },
    { "recipeName": string, "ingredients": string[] },
    { "recipeName": string, "ingredients": string[] }
  ]
}

Each option's "ingredients" is 3-6 lines, each "Ingredient: amount" as plain text, e.g.
"Chicken Breast: 170g (~6.0 oz)".

Rules:
- Use real, common grocery-store ingredients and realistic gram amounts — round to numbers a coach would
  actually tell a client (nearest 5g for most things, nearest whole unit for eggs/slices/scoops).
- Every ingredient line MUST include an explicit gram amount ("Xg") — this is checked against real food
  data afterward, so an amount given in only ounces/cups/servings with no gram figure cannot be verified.
- The ingredients together should land close to the given protein/carbs/fat targets (within about 10%).
- Respect the given diet archetype and any dietary restrictions or disliked foods exactly — never include
  a restricted or disliked ingredient.
- Each ingredient line is plain text only — no HTML tags, no markdown, no asterisks.
- Prefer favorite/requested foods when they're compatible with the targets and restrictions.
- Make the three options genuinely different from each other — vary the main protein source, the carb
  source, or the overall dish style — not three near-duplicates with minor amount tweaks.`;

export class AiMealShapeError extends Error {}

export interface MealSlotRequest {
  meta: AiCallMeta;
  mealSlot: string;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  archetype: string;
  dietaryRestrictions?: string | null;
  favoriteFoods?: string | null;
  rules: FoodRules | null;
}

export async function suggestMealSlotOptions(
  supabase: SupabaseClient,
  req: MealSlotRequest
): Promise<{ options: VerifiedMealOption[]; droppedForPreferences: number; droppedForMacros: number }> {
  const rulesText = req.rules ? rulesForPrompt(req.rules) : "";
  const userText = `Meal slot: ${req.mealSlot}
Diet archetype: ${req.archetype}
Target protein: ${req.proteinTarget}g
Target carbs: ${req.carbsTarget}g
Target fat: ${req.fatTarget}g
Dietary restrictions / dislikes: ${req.dietaryRestrictions || "none given"}
Favorite foods / requests: ${req.favoriteFoods || "none given"}${rulesText ? `\n${rulesText}` : ""}`;

  const text = await callClaude({ meta: req.meta, system: MEAL_SLOT_SYSTEM_PROMPT, userText, maxTokens: 2048 });
  const parsed = JSON.parse(extractJson(text));
  const isValidOption = (o: unknown): o is RawMealOption => {
    const r = o as Record<string, unknown>;
    return !!r && typeof r.recipeName === "string" && Array.isArray(r.ingredients) && r.ingredients.every((i: unknown) => typeof i === "string");
  };
  if (!Array.isArray(parsed?.options) || parsed.options.length === 0 || !parsed.options.every(isValidOption)) {
    throw new AiMealShapeError("AI response wasn't in the expected shape — try again.");
  }
  const allVerified = await verifyMealOptions(supabase, parsed.options as RawMealOption[]);
  return checkMealOptions(allVerified, req.rules, { proteinG: req.proteinTarget, carbsG: req.carbsTarget, fatG: req.fatTarget });
}

/** A verified AI option as it is saved in a plan (the same fields the coach's planner saves for an AI option). */
export function choiceFromVerified(o: VerifiedMealOption, i: number): MealRecipeChoice {
  return {
    recipeId: `ai-${Date.now()}-${i}`,
    recipeName: o.recipeName,
    ingredients: o.ingredients.map((line) => line.rawLine),
    isAi: true,
    source: "ai",
    lines: o.ingredients.map((line) => ({ name: line.matchedDescription ?? line.name ?? line.rawLine, label: line.rawLine, grams: line.grams })),
    macros: { proteinG: Math.round(o.totalProtein), carbsG: Math.round(o.totalCarbs), fatG: Math.round(o.totalFat), calories: Math.round(o.totalKcal) },
  };
}
