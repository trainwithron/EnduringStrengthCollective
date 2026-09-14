import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";

// Natural-language quick-log (calorie_tracking_ux_research_and_plan.md,
// V1) — mirrors app/api/ai/parse-workout/route.ts's shape closely.
// Deliberately does NOT look anything up in a real food database — a
// real USDA ingredient database is its own, larger, deferred project.
// Instead this asks Claude to estimate macros directly from its own
// nutrition knowledge, the same way the AI program builder already
// estimates things — always a rough estimate, always confirmed by the
// athlete before it's saved (see meal-checkoff-list.tsx), never treated
// as lab-grade accurate.
const SYSTEM_PROMPT = `A client describes, in their own words, food they ate (or are about to eat).
Estimate its total nutrition and respond with ONLY this JSON object, no markdown fences, no explanation:
{
  "description": string,   // a clean, short restatement of what was eaten (e.g. "2 eggs, 2 slices wheat toast, 1 tbsp butter")
  "calories": number,      // your best estimate, whole number
  "proteinG": number,      // grams, whole number
  "carbsG": number,        // grams, whole number
  "fatG": number           // grams, whole number
}

Rules:
- This is a rough estimate for a fitness app, not a lab analysis — use realistic, typical portions and
  preparations when the client doesn't specify exact amounts (e.g. "a chicken breast" = ~6oz cooked).
- If genuinely no food is described (e.g. the text is empty, gibberish, or clearly not about food),
  respond with exactly: {"error": "That doesn't look like a food description — try again with what you ate."}
- Never ask a clarifying question. Make your best reasonable estimate from what's given.`;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "Quick-log isn't configured yet — ask your admin to add an ANTHROPIC_API_KEY." },
      { status: 503 }
    );
  }

  const { text } = await request.json();
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Missing food description" }, { status: 400 });
  }

  try {
    const raw = await callClaude({
      system: SYSTEM_PROMPT,
      userText: text.trim(),
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
      return NextResponse.json({ error: "Couldn't estimate that — try describing it differently." }, { status: 502 });
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
