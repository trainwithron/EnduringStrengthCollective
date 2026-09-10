import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";

// "Mix & Macros" — an AI-suggested extra meal option for one slot,
// alongside (not replacing) the deterministic recipe engine's own
// options. Deliberately scoped to one meal at a time, called from a
// per-meal "Suggest with AI" button, rather than generating an entire
// day's plan in one shot: easier to keep each suggestion close to its
// exact macro target, and a bad suggestion only costs a re-roll of one
// meal, not the whole day.
const SYSTEM_PROMPT = `You are a nutrition coach building one real, appetizing meal that hits a specific
macro target closely. Respond with ONLY a JSON object shaped exactly like this, no other text and no
markdown code fence:

{
  "recipeName": string,        // a short, appetizing name for the meal
  "ingredients": string[]      // 3-6 lines, each "Ingredient: amount" as plain text, e.g. "Chicken Breast: 170g (~6.0 oz)"
}

Rules:
- Use real, common grocery-store ingredients and realistic gram amounts — round to numbers a coach would
  actually tell a client (nearest 5g for most things, nearest whole unit for eggs/slices/scoops).
- The ingredients together should land close to the given protein/carbs/fat targets (within about 10%).
- Respect the given diet archetype and any dietary restrictions or disliked foods exactly — never include
  a restricted or disliked ingredient.
- Each ingredient line is plain text only — no HTML tags, no markdown, no asterisks.
- Prefer favorite/requested foods when they're compatible with the targets and restrictions.`;

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
    const text = await callClaude({ system: SYSTEM_PROMPT, userText, maxTokens: 1024 });
    const parsed = JSON.parse(extractJson(text));

    if (
      typeof parsed?.recipeName !== "string" ||
      !Array.isArray(parsed?.ingredients) ||
      parsed.ingredients.some((i: unknown) => typeof i !== "string")
    ) {
      return NextResponse.json({ error: "AI response wasn't in the expected shape — try again." }, { status: 502 });
    }

    return NextResponse.json({
      recipeName: parsed.recipeName as string,
      ingredients: parsed.ingredients as string[],
    });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't generate a suggestion: ${message}` }, { status: 502 });
  }
}
