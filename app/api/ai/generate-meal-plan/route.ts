import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import { verifyMealOptions, type RawMealOption } from "@/lib/meal-option-verification";

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

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI meal suggestions aren't configured yet — ask your admin to add an ANTHROPIC_API_KEY." },
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

  const userText = `Meal slot: ${mealSlot}
Diet archetype: ${archetype}
Target protein: ${proteinTarget}g
Target carbs: ${carbsTarget}g
Target fat: ${fatTarget}g
Dietary restrictions / dislikes: ${dietaryRestrictions || "none given"}
Favorite foods / requests: ${favoriteFoods || "none given"}`;

  try {
    const text = await callClaude({ system: SYSTEM_PROMPT, userText, maxTokens: 2048 });
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
    const verifiedOptions = await verifyMealOptions(supabase, parsed.options as RawMealOption[]);

    return NextResponse.json({ options: verifiedOptions });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't generate a suggestion: ${message}` }, { status: 502 });
  }
}
