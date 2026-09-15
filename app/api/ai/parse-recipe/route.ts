import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";

// Replaces the manual "+ New recipe → fill in every ingredient by hand"
// flow (live_walkthrough_round2_findings.md — Ron's own read, backed by
// food_logging_market_research.md's finding that manual-entry nutrition
// UIs lose to a lower-friction mechanism). A coach describes a recipe in
// plain language; this estimates the same structured shape
// recipe_ingredients already requires, mirroring app/api/ai/parse-food-log/
// route.ts's estimate-don't-look-up approach.
const SYSTEM_PROMPT = `A coach describes a recipe in plain language for their nutrition-coaching app.
Parse it into structured JSON and respond with ONLY this JSON object, no markdown fences, no explanation:
{
  "name": string,
  "slot": "breakfast" | "lunch" | "dinner" | "snack" | "any",
  "archetypes": string[],   // subset of ["omnivore","vegetarian","vegan","carnivore","keto","paleo"], your best guess from the ingredients, at least one
  "keywords": string[],     // a few short searchable tags, e.g. ["high protein","quick"]
  "ingredients": [
    {
      "label": string,                    // e.g. "Chicken breast, cooked"
      "role": "protein_source" | "carb_source" | "fat_source" | "fixed",
      "proteinPer100g": number,           // grams per 100g; 0 if role is "fixed"
      "carbsPer100g": number,
      "fatPer100g": number,
      "fixedDisplayText": string | null   // only when role is "fixed", e.g. "Salt, pepper, garlic powder to taste"; null otherwise
    }
  ]
}

Rules:
- At most ONE ingredient may have role "protein_source", at most ONE "carb_source", at most ONE "fat_source" — these
  are the recipe's scalable macro anchors, each solved directly from a client's target using this per-100g density.
  Everything else (garnishes, low-calorie vegetables, seasonings, sauces) becomes role "fixed" with fixedDisplayText
  describing it and all three macros set to 0.
- If a recipe has more than one plausible candidate for a role (e.g. both chicken and eggs), pick whichever
  contributes more of that macro as the scalable one; the other becomes "fixed".
- Use realistic per-100g macro values from general nutrition knowledge for the scalable ingredients.
- This is a rough estimate for a fitness app, not a lab analysis.
- If genuinely nothing resembling a recipe or food is described, respond with exactly:
  {"error": "That doesn't look like a recipe — try describing the ingredients and how it's made."}
- Never ask a clarifying question. Make your best reasonable interpretation.`;

const VALID_SLOTS = new Set(["breakfast", "lunch", "dinner", "snack", "any"]);
const VALID_ROLES = new Set(["protein_source", "carb_source", "fat_source", "fixed"]);

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "AI recipe parsing isn't configured yet — ask your admin to add an ANTHROPIC_API_KEY." },
      { status: 503 }
    );
  }

  const { description } = await request.json();
  if (!description || typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "Missing recipe description" }, { status: 400 });
  }

  try {
    const raw = await callClaude({
      system: SYSTEM_PROMPT,
      userText: description.trim(),
      maxTokens: 1024,
    });

    const parsed = JSON.parse(extractJson(raw));
    if (parsed?.error) {
      return NextResponse.json({ error: parsed.error }, { status: 422 });
    }

    if (
      typeof parsed?.name !== "string" ||
      !VALID_SLOTS.has(parsed?.slot) ||
      !Array.isArray(parsed?.archetypes) ||
      !Array.isArray(parsed?.keywords) ||
      !Array.isArray(parsed?.ingredients) ||
      parsed.ingredients.length === 0
    ) {
      return NextResponse.json(
        { error: "Couldn't parse that into a recipe — try describing it differently." },
        { status: 502 }
      );
    }

    const roleCounts: Record<string, number> = { protein_source: 0, carb_source: 0, fat_source: 0 };
    const ingredients = parsed.ingredients.map((ing: any) => {
      const role = VALID_ROLES.has(ing?.role) ? ing.role : "fixed";
      // Enforce the at-most-one-per-scalable-role rule server-side too —
      // never trust the model to have followed its own instructions
      // exactly. A second candidate for an already-filled role demotes
      // to fixed rather than being dropped.
      const demoted = role !== "fixed" && roleCounts[role] >= 1;
      if (!demoted && role !== "fixed") roleCounts[role]++;
      const finalRole = demoted ? "fixed" : role;
      return {
        label: typeof ing?.label === "string" ? ing.label : "Ingredient",
        role: finalRole,
        proteinPer100g: finalRole === "fixed" ? 0 : Math.max(0, Number(ing?.proteinPer100g) || 0),
        carbsPer100g: finalRole === "fixed" ? 0 : Math.max(0, Number(ing?.carbsPer100g) || 0),
        fatPer100g: finalRole === "fixed" ? 0 : Math.max(0, Number(ing?.fatPer100g) || 0),
        fixedDisplayText:
          finalRole === "fixed" ? (typeof ing?.fixedDisplayText === "string" ? ing.fixedDisplayText : ing?.label ?? "Ingredient") : null,
      };
    });

    return NextResponse.json({
      name: parsed.name,
      slot: parsed.slot,
      archetypes: parsed.archetypes.filter((a: unknown) => typeof a === "string"),
      keywords: parsed.keywords.filter((k: unknown) => typeof k === "string"),
      ingredients,
    });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't parse that recipe: ${message}` }, { status: 502 });
  }
}
