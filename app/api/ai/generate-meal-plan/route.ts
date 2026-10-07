import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { verifyMealOptions, type RawMealOption } from "@/lib/meal-option-verification";
import { MEAL_SLOT_DELIVERED_FEATURE } from "@/lib/ai-refund-decision";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rowToPreferences } from "@/lib/nutrition-preferences";
import { filterOptionsByRules, rulesForPrompt } from "@/lib/plan-preference-check";

// "The Nutrition Spot" (nutrition_spot_revamp_scoping_sept19.md,
// retiring the old "Mix & Macros" name — AI is now the primary meal-
// suggestion source, not an extra option alongside the deterministic
// recipe engine, which now only serves as an automatic fallback when AI
// is unavailable; see meal-plan-generator.tsx's handleAiSuggest). Still
// deliberately scoped to one meal slot at a time — easier to keep a
// suggestion close to its exact macro target, and a bad batch only
// costs a re-roll of one meal, not the whole day.
//
// Real fix this revamp makes non-negotiable: the AI's own claimed
// macros are NEVER trusted as-is. Every returned option's ingredient
// lines get matched against real USDA food data and re-computed for
// real (lib/meal-option-verification.ts) before anything is returned —
// an option that fails to match confidently is discarded here, not
// shown with an unverified number.
const SYSTEM_PROMPT = `You are a nutrition coach building three real, appetizing meal options for one meal
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

const VALID_SLOTS = ["breakfast", "lunch", "dinner", "snack", "any"];
const VALID_ARCHETYPES = ["omnivore", "vegetarian", "vegan", "carnivore", "keto", "paleo"];

// AI generation can take well over the platform default; without this the request is cut off mid-way.
export const maxDuration = 120;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Meal suggestions are a coach tool. A signed-in client has no use for it, and every call spends the platform's
  // AI budget, so it requires coaching at least one group.
  const { data: coachRow } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();
  if (!coachRow) return NextResponse.json({ error: "Only coaches can generate meal suggestions." }, { status: 403 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI meal suggestions aren't available yet." },
      { status: 503 }
    );
  }

  const {
    mealSlot,
    proteinTarget,
    carbsTarget,
    fatTarget,
    archetype,
    dietaryRestrictions,
    favoriteFoods,
    athleteId,
  } = await request.json();

  if (
    !VALID_SLOTS.includes(mealSlot) ||
    !VALID_ARCHETYPES.includes(archetype) ||
    typeof proteinTarget !== "number" ||
    typeof carbsTarget !== "number" ||
    typeof fatTarget !== "number"
  ) {
    return NextResponse.json({ error: "Missing or invalid meal target." }, { status: 400 });
  }

  const tooLongText = (v: unknown) => typeof v === "string" && v.length > 500;
  if (tooLongText(dietaryRestrictions) || tooLongText(favoriteFoods)) {
    return NextResponse.json({ error: "Keep restrictions and favorites under 500 characters." }, { status: 400 });
  }

  // The client's own rules are read here, on the server, from the database (never from what the browser sent), through the coach's own session so row security decides
  // whether this coach may see them. A missing row, or a client who is not theirs, simply means no structured rules.
  let rules: { allergies: string[]; intolerances: string[]; dislikes: string[]; dietType: string } | null = null;
  if (typeof athleteId === "string" && /^[0-9a-f-]{36}$/i.test(athleteId)) {
    const { data: prefsRow } = await supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", athleteId).maybeSingle();
    if (prefsRow) {
      const p = rowToPreferences(prefsRow as Record<string, unknown>);
      rules = { allergies: p.allergies, intolerances: p.intolerances, dislikes: p.dislikes, dietType: p.dietType };
    }
  }
  const rulesText = rules ? rulesForPrompt(rules) : "";

  const userText = `Meal slot: ${mealSlot}
Diet archetype: ${archetype}
Target protein: ${proteinTarget}g
Target carbs: ${carbsTarget}g
Target fat: ${fatTarget}g
Dietary restrictions / dislikes: ${dietaryRestrictions || "none given"}
Favorite foods / requests: ${favoriteFoods || "none given"}${rulesText ? `\n${rulesText}` : ""}`;

  try {
    const text = await callClaude({ meta: { feature: "meal_plan_slot", userId: user.id }, system: SYSTEM_PROMPT, userText, maxTokens: 2048 });
    const parsed = JSON.parse(extractJson(text));

    const isValidOption = (o: unknown): o is RawMealOption => {
      const r = o as Record<string, unknown>;
      return (
        !!r &&
        typeof r.recipeName === "string" &&
        Array.isArray(r.ingredients) &&
        r.ingredients.every((i: unknown) => typeof i === "string")
      );
    };

    if (!Array.isArray(parsed?.options) || parsed.options.length === 0 || !parsed.options.every(isValidOption)) {
      return NextResponse.json({ error: "AI response wasn't in the expected shape — try again." }, { status: 502 });
    }

    // The real accuracy layer — every option's macros get re-computed
    // from real matched USDA food data here, never returned on the AI's
    // own claimed numbers. An option that can't be confidently matched
    // is dropped rather than surfaced as pickable with an unverified
    // number (nutrition_spot_revamp_scoping_sept19.md's own bar).
    const allVerified = await verifyMealOptions(supabase, parsed.options as RawMealOption[]);
    // The model is told the rules, and every option is ALSO checked against them here: an option that names an allergen, a food they dislike or breaks their diet is never
    // returned, whatever the model did. (A line that says "may contain" is not modelled.)
    // The text checked is the option's name, each ingredient line AND the real food each line was matched to, but what is returned is the original verified option.
    const checked = allVerified.map((o) => ({
      recipeName: o.recipeName,
      ingredients: o.ingredients.flatMap((l) => [l.rawLine, ...(l.matchedDescription ? [l.matchedDescription] : [])]),
      original: o,
    }));
    const { kept, dropped: droppedOptions } = rules ? filterOptionsByRules(checked, rules) : { kept: checked, dropped: [] as typeof checked };
    const verifiedOptions = kept.map((k) => k.original);
    const droppedForPreferences = droppedOptions.length;

    // The server's own record that the AI delivered something usable, so a later "the generation failed" refund can be checked against it instead of
    // believing the browser (lib/ai-refund-decision.ts). Best effort: a failed write only means an automatic refund stays possible, never blocks the coach.
    if (verifiedOptions.some((o) => o.confident)) {
      try {
        const { error: deliveredError } = await createServiceRoleClient()
          .from("ai_usage_log")
          .insert({ user_id: user.id, coach_id: user.id, feature: MEAL_SLOT_DELIVERED_FEATURE, status: "ok", completed_at: new Date().toISOString() });
        // supabase-js reports a failed insert in the result, it does not throw: log it, so a run of failures is visible.
        if (deliveredError) console.error("[generate-meal-plan] could not record delivery:", deliveredError.message);
      } catch (e) {
        console.error("[generate-meal-plan] could not record delivery:", e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ options: verifiedOptions, droppedForPreferences });
  } catch (err) {
    if (err instanceof AiRateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't generate a suggestion: ${message}` }, { status: 502 });
  }
}
