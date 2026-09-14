import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";

// Lightweight NL program builder (coach_mobile_app_redesign_plan.md,
// locked 2026-09-14) — mirrors parse-food-log's shape almost exactly.
// Deliberately scoped to TODAY'S SESSION ONLY: adding exercises/sets to
// a session already in progress, never a multi-week generator (that
// stays a desktop Program Builder job). A prompt describing more than
// one week gets a clear refusal, not a guessed-at multi-week structure.
const SYSTEM_PROMPT = `A coach describes, in their own words, exercises to add to a client's
in-person training session happening right now. Extract every exercise into a JSON array.
Respond with ONLY the JSON, no markdown fences, no explanation.

Each array element is one exercise:
{
  "exerciseName": string,  // as the coach said it, not "corrected"
  "sets": number,          // total sets, integer, minimum 1
  "reps": number | null,   // a single rep target (not a range) — if a range was given, use its lower number
  "weight": number | null, // a plain number in whatever unit was said (lbs or kg), null if not given
  "rpe": number | null     // null if not mentioned
}

Rules:
- This is for ONE session happening today — never a multi-week program. If the request describes
  more than one week, or sounds like building out a full training block, respond with exactly:
  {"error": "That sounds like a multi-week program — build that in the full Program Builder on desktop instead."}
- One element per exercise, not per set — "4 sets of bench at 185" is ONE element with sets=4.
- Preserve exercise names as said — do not rename or "correct" them.
- If genuinely nothing describing exercises is present, respond with exactly:
  {"error": "Couldn't find any exercises in that — try describing sets/reps/weight for each one."}`;

interface ParsedExercise {
  exerciseName: string;
  sets: number;
  reps: number | null;
  weight: number | null;
  rpe: number | null;
}

function isValidExercise(row: unknown): row is ParsedExercise {
  const r = row as Record<string, unknown>;
  return (
    !!r &&
    typeof r.exerciseName === "string" &&
    r.exerciseName.trim().length > 0 &&
    typeof r.sets === "number"
  );
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json(
      { error: "Quick add isn't configured yet — ask your admin to add an ANTHROPIC_API_KEY." },
      { status: 503 }
    );
  }

  const { text } = await request.json();
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Missing description" }, { status: 400 });
  }

  try {
    const raw = await callClaude({
      system: SYSTEM_PROMPT,
      userText: text.trim(),
      maxTokens: 1024,
    });

    const parsed = JSON.parse(extractJson(raw));
    if (!Array.isArray(parsed)) {
      if (parsed?.error) return NextResponse.json({ error: parsed.error }, { status: 422 });
      return NextResponse.json({ error: "Couldn't parse that — try again." }, { status: 502 });
    }

    const exercises: ParsedExercise[] = parsed.filter(isValidExercise).map((r) => ({
      exerciseName: r.exerciseName,
      sets: Math.max(1, Math.round(r.sets)),
      reps: typeof r.reps === "number" ? Math.max(0, Math.round(r.reps)) : null,
      weight: typeof r.weight === "number" ? r.weight : null,
      rpe: typeof r.rpe === "number" ? r.rpe : null,
    }));

    if (exercises.length === 0) {
      return NextResponse.json(
        { error: "Couldn't find any exercises in that — try describing sets/reps/weight for each one." },
        { status: 422 }
      );
    }

    return NextResponse.json({ exercises });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't parse that: ${message}` }, { status: 502 });
  }
}
