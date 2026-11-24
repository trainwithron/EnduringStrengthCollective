import { safeErrorDetail } from "@/lib/safe-error";
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import { userBelongsToAGroup } from "@/lib/ai-nutrition-clamp";
import { AiRateLimitedError, aiInputTooLong } from "@/lib/ai-usage";
import { combineItems, matchFoodItem, parseItems, MAX_ITEMS } from "@/lib/food-log-match";

// Natural-language quick-log (calorie_tracking_ux_research_and_plan.md, V1). Since Nov 23 (Spotters keep up) the model only SPLITS what the client typed into foods and amounts;
// each food is then looked up in the real food database (the USDA foods, everyday and packaged, with the spelling help: lib/food-log-match.ts) and its numbers come from the USDA
// row scaled to the amount. The model's own estimate for a food is kept only as the fallback when nothing matches, and then the entry is tagged as an estimate. Always confirmed
// by the client before it is saved (see meal-checkoff-list.tsx).
const SYSTEM_PROMPT = `A client describes, in their own words, food they ate (or are about to eat).
Split it into the separate foods and respond with ONLY this JSON object, no markdown fences, no explanation:
{
  "items": [
    {
      "food": string,      // the plain food name, the way it would be searched in a food database (e.g. "egg", "whole milk", "white rice cooked", "peanut butter")
      "quantity": number,  // how many of the unit (e.g. 2 for "2 eggs", 1 for "a cup of milk"); 1 when not said
      "unit": string,      // the unit as said or implied: "large", "cup", "slice", "tbsp", "g", "oz", "piece", "serving"
      "grams": number,     // your best estimate of the whole amount in grams
      "calories": number,  // your best estimate for the whole amount, whole number
      "proteinG": number,  // grams, whole number
      "carbsG": number,    // grams, whole number
      "fatG": number       // grams, whole number
    }
  ]
}

Rules:
- One item per food, at most ${MAX_ITEMS}. "2 eggs and a cup of whole milk" is two items.
- Use realistic, typical portions and preparations when the client doesn't specify exact amounts (e.g. "a chicken breast" = ~170 g cooked).
- If genuinely no food is described (e.g. the text is empty, gibberish, or clearly not about food),
  respond with exactly: {"error": "That doesn't look like a food description — try again with what you ate."}
- Never ask a clarifying question. Make your best reasonable estimate from what's given.`;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await userBelongsToAGroup(supabase, user.id))) return NextResponse.json({ error: "Join a group first to use this." }, { status: 403 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "Quick-log isn't available yet." },
      { status: 503 }
    );
  }

  const { text } = await request.json();
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Missing food description" }, { status: 400 });
  }
  const tooLong = aiInputTooLong("food_log_parse", text);
  if (tooLong) return NextResponse.json({ error: tooLong }, { status: 400 });

  try {
    const raw = await callClaude({
      meta: { feature: "food_log_parse", userId: user.id },
      system: SYSTEM_PROMPT,
      userText: text.trim(),
      maxTokens: 1500,
    });

    const parsed = JSON.parse(extractJson(raw));
    if (parsed?.error) {
      return NextResponse.json({ error: parsed.error }, { status: 422 });
    }
    const items = parseItems(parsed);
    if (!items) {
      return NextResponse.json({ error: "Couldn't estimate that — try describing it differently." }, { status: 502 });
    }

    // Each food looked up as the client (the same reads the food search makes), at the same time.
    const matched = await Promise.all(items.map((item) => matchFoodItem(supabase, item)));
    return NextResponse.json(combineItems(matched));
  } catch (err) {
    if (err instanceof AiRateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = safeErrorDetail(err);
    return NextResponse.json({ error: `Couldn't estimate that: ${message}` }, { status: 502 });
  }
}
