import { safeErrorDetail } from "@/lib/safe-error";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { MEAL_SLOT_DELIVERED_FEATURE } from "@/lib/ai-refund-decision";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rowToPreferences } from "@/lib/nutrition-preferences";
import { AiMealShapeError, suggestMealSlotOptions } from "@/lib/ai-meal-slot";

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
// shown with an unverified number. The prompt and the checks live in lib/ai-meal-slot.ts (the automatic allergy rebuild uses the same ones).

const VALID_SLOTS = ["breakfast", "lunch", "dinner", "snack", "any"];
const VALID_ARCHETYPES = ["omnivore", "vegetarian", "vegan", "carnivore", "keto", "paleo"];

// AI generation can take well over the platform default; without this the request is cut off mid-way.
export const maxDuration = 300;

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
    extraAllergies,
    extraDislikes,
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
  // whether this coach may see them. A missing row, or no client at all (the standalone tools), simply means no structured rules. FAIL CLOSED: a client id that is
  // malformed, or rules that could not be READ, stop the request: nothing is generated that has not been checked against them.
  let rules: { allergies: string[]; intolerances: string[]; dislikes: string[]; dietType: string } | null = null;
  if (athleteId != null) {
    if (typeof athleteId !== "string" || !/^[0-9a-f-]{36}$/i.test(athleteId)) {
      return NextResponse.json({ error: "Couldn't check this client's food rules, so nothing was generated." }, { status: 400 });
    }
    const { data: prefsRow, error: prefsError } = await supabase.from("client_nutrition_preferences").select("*").eq("athlete_id", athleteId).maybeSingle();
    if (prefsError) {
      console.error("[generate-meal-plan] could not read food rules:", prefsError.message);
      return NextResponse.json({ error: "Couldn't check this client's food rules, so nothing was generated. Try again in a moment." }, { status: 503 });
    }
    if (prefsRow) {
      const p = rowToPreferences(prefsRow as Record<string, unknown>);
      rules = { allergies: p.allergies, intolerances: p.intolerances, dislikes: p.dislikes, dietType: p.dietType };
    }
  }
  // Items the coach typed in the planner's note, sent as structured allergies and dislikes. They can only ADD restrictions: they are unioned into the saved rules (never
  // replace or relax them), limited in number and length, and letters only.
  const cleanExtra = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim().toLowerCase())
          .filter((x) => /^[a-z][a-z -]{1,39}$/.test(x))
          .slice(0, 20)
      : [];
  const extraA = cleanExtra(extraAllergies);
  const extraD = cleanExtra(extraDislikes);
  if (extraA.length > 0 || extraD.length > 0) {
    rules = {
      allergies: [...new Set([...(rules?.allergies ?? []), ...extraA])],
      intolerances: rules?.intolerances ?? [],
      dislikes: [...new Set([...(rules?.dislikes ?? []), ...extraD])],
      dietType: rules?.dietType ?? "omnivore",
    };
  }
  try {
    const { options: verifiedOptions, droppedForPreferences, droppedForMacros } = await suggestMealSlotOptions(supabase, {
      meta: { feature: "meal_plan_slot", userId: user.id },
      mealSlot,
      proteinTarget,
      carbsTarget,
      fatTarget,
      archetype,
      dietaryRestrictions,
      favoriteFoods,
      rules,
    });

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

    return NextResponse.json({ options: verifiedOptions, droppedForPreferences, droppedForMacros });
  } catch (err) {
    if (err instanceof AiRateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof AiMealShapeError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = safeErrorDetail(err);
    return NextResponse.json({ error: `Couldn't generate a suggestion: ${message}` }, { status: 502 });
  }
}
