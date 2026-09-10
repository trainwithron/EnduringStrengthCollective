import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import type { ParsedImportRow } from "@/lib/workout-import-parser";

// Generates a full draft program from a coach's plain-English description
// — "the bones" of an AI program builder, deliberately built as a
// generation source for the EXISTING import review pipeline
// (ImportWizard.prepareImport) rather than a parallel program-creation
// path. That pipeline already does the real work this needs: matching
// generated exercise names against the coach's real library, flagging
// ambiguous guesses for review, and only writing to the database once
// the coach confirms. Nothing here is "trained" on the coach's data in
// the machine-learning sense — it's the same grounded-generation
// approach as the AI photo importer, just fed the coach's real exercise
// list as context so it prefers reusing what they already have.
const SYSTEM_PROMPT = `You are an experienced strength & conditioning coach writing a training program
from a plain-English description. Respond with ONLY a JSON object shaped exactly like this — no markdown
fences, no explanation:

{
  "programName": string,        // short, e.g. "12-Week Strength Block"
  "rows": [
    {
      "week": string,          // e.g. "Week 1"
      "day": string,           // e.g. "Day 1" — reuse the same day label across an exercise's day
      "exerciseName": string,  // prefer an EXACT name from the coach's exercise library below if a
                                 // suitable one exists; only invent a new name if nothing in the
                                 // library fits (e.g. a movement pattern they don't have yet)
      "sets": number,          // integer, minimum 1
      "reps": string | null,   // e.g. "8", "8-10", "AMRAP" — null only for pure time-based work
      "weight": number | null, // leave null unless the description gives you a real number/percentage
                                 // to compute from (e.g. "start at 70% of a 225 squat" -> 157)
      "rpe": number | null,
      "rest": string | null,
      "timeSeconds": number | null
    }
  ]
}

Rules:
- Build a real, coherent program matching the description's length, frequency, and focus. If the
  description doesn't specify a length, default to 4 weeks. If it doesn't specify days/week, default to
  the frequency that best fits the stated focus (3-4 for general strength, higher for hypertrophy splits).
- One row per exercise per day, not one row per set (a 3x8 exercise is ONE row with sets=3, reps="8").
- Vary the program sensibly week to week (progressive overload, or the specific progression scheme
  described) rather than repeating the exact same week verbatim.
- Respond with ONLY the JSON object described. No leading or trailing text.`;

function isValidRow(row: any): row is ParsedImportRow {
  return (
    row &&
    typeof row.week === "string" &&
    typeof row.day === "string" &&
    typeof row.exerciseName === "string" &&
    row.exerciseName.trim().length > 0 &&
    typeof row.sets === "number"
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
      { error: "The AI program builder isn't configured yet — ask your admin to add an ANTHROPIC_API_KEY." },
      { status: 503 }
    );
  }

  const { prompt, groupId } = await request.json();
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json({ error: "Describe the program you want first." }, { status: 400 });
  }
  if (!groupId) {
    return NextResponse.json({ error: "Missing groupId." }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Only coaches can generate programs." }, { status: 403 });
  }

  const { data: libraryRows } = await supabase
    .from("exercise_library")
    .select("name")
    .eq("created_by", user.id)
    .order("name")
    .limit(300);
  const libraryNames = (libraryRows ?? []).map((r) => r.name);

  try {
    const text = await callClaude({
      system: SYSTEM_PROMPT,
      userText:
        `Coach's exercise library (prefer these exact names where they fit):\n${libraryNames.join(", ") || "(empty — invent sensible exercise names)"}\n\n` +
        `Program description: ${prompt.trim()}`,
      maxTokens: 8192,
    });

    const parsed = JSON.parse(extractJson(text));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) {
      return NextResponse.json(
        { error: "AI response wasn't in the expected shape — try rephrasing your description." },
        { status: 502 }
      );
    }

    const rows: ParsedImportRow[] = parsed.rows.filter(isValidRow).map((r: any) => ({
      week: r.week,
      day: r.day,
      exerciseName: r.exerciseName,
      sets: Math.max(1, Math.round(r.sets)),
      reps: r.reps != null ? String(r.reps) : null,
      weight: typeof r.weight === "number" ? r.weight : null,
      rpe: typeof r.rpe === "number" ? r.rpe : null,
      rest: r.rest != null ? String(r.rest) : null,
      timeSeconds: typeof r.timeSeconds === "number" ? r.timeSeconds : null,
    }));

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Couldn't generate a program from that description — try adding more detail." },
        { status: 422 }
      );
    }

    const programName = typeof parsed.programName === "string" && parsed.programName.trim()
      ? parsed.programName.trim()
      : "AI-Generated Program";

    return NextResponse.json({ rows, programName });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't generate a program: ${message}` }, { status: 502 });
  }
}
