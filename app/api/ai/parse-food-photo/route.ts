import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";

// V2 #3 from calorie_tracking_ux_research_and_plan.md — AI photo
// logging, sequenced deliberately last (real, sourced accuracy limits:
// peer-reviewed research finds ~20% underreporting vs. gold-standard
// weighed food, and even a strong dedicated model like SnappyMeal's best
// config still carries ~124 kcal mean error). Macros only, never a
// micronutrient panel from a photo — mirrors app/api/ai/parse-workout's
// vision-call shape closely. Always confirm-before-save, always framed
// as a rough estimate, never silently written.
const SYSTEM_PROMPT = `A client photographs a plate of food (or a restaurant/packaged meal). Estimate
its total nutrition and respond with ONLY this JSON object, no markdown fences, no explanation:
{
  "description": string,   // a clean, short description of what's visible (e.g. "grilled chicken, rice, broccoli")
  "calories": number,      // your best estimate, whole number
  "proteinG": number,      // grams, whole number
  "carbsG": number,        // grams, whole number
  "fatG": number           // grams, whole number
}

Rules:
- This is a rough visual estimate for a fitness app, not a lab analysis. Photo-based estimates are
  genuinely imprecise (hidden oils/sauces, unclear portion depth) — give your honest best guess using
  typical realistic portions, don't hedge toward round "safe" numbers.
- If the image doesn't clearly show food (e.g. it's blurry, empty, or not food at all), respond with
  exactly: {"error": "Couldn't make out food in that photo — try a clearer shot or describe it instead."}
- Never ask a clarifying question. Make your best reasonable estimate from what's visible.`;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "Photo logging isn't configured yet — ask your admin to add an ANTHROPIC_API_KEY." },
      { status: 503 }
    );
  }

  const { imageBase64, mediaType } = await request.json();
  if (!imageBase64 || !mediaType) {
    return NextResponse.json({ error: "Missing imageBase64 or mediaType" }, { status: 400 });
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(mediaType)) {
    return NextResponse.json({ error: "Unsupported image type — use a JPEG, PNG, WebP, or GIF." }, { status: 400 });
  }

  try {
    const raw = await callClaude({
      system: SYSTEM_PROMPT,
      userText: "Estimate the nutrition of the food in this photo as the JSON object described.",
      image: { mediaType, base64Data: imageBase64 },
      maxTokens: 512,
    });

    const parsed = JSON.parse(extractJson(raw));
    if (parsed?.error) {
      return NextResponse.json({ error: parsed.error }, { status: 422 });
    }
    if (
      typeof parsed?.description !== "string" ||
      typeof parsed?.calories !== "number" ||
      typeof parsed?.proteinG !== "number" ||
      typeof parsed?.carbsG !== "number" ||
      typeof parsed?.fatG !== "number"
    ) {
      return NextResponse.json({ error: "Couldn't estimate that photo — try again or describe it instead." }, { status: 502 });
    }

    return NextResponse.json({
      description: parsed.description,
      calories: Math.max(0, Math.round(parsed.calories)),
      proteinG: Math.max(0, Math.round(parsed.proteinG)),
      carbsG: Math.max(0, Math.round(parsed.carbsG)),
      fatG: Math.max(0, Math.round(parsed.fatG)),
    });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't estimate that: ${message}` }, { status: 502 });
  }
}
