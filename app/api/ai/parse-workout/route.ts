import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import type { ParsedImportRow } from "@/lib/workout-import-parser";

const SYSTEM_PROMPT = `You read a photo, screenshot, or PDF page of a workout program — it might be
from another training platform (TrainHeroic, TrueCoach, Trainerize), a spreadsheet screenshot, or a
handwritten/typed sheet — and extract every exercise into a flat JSON array.

Each array element is one exercise entry for one day, shaped exactly like this:
{
  "week": string,        // e.g. "Week 1" — if the image shows no week grouping, use "Week 1" for everything
  "day": string,          // e.g. "Day 1" or "Monday" — whatever label the source uses; default "Day 1" if none
  "exerciseName": string, // the exercise's name as written
  "sets": number,         // total prescribed sets for this exercise (integer, minimum 1)
  "reps": string | null,  // e.g. "8", "8-10", "AMRAP" — as text, preserving ranges/notes; null if not shown
  "weight": number | null,     // a plain number in whatever unit is shown (lbs or kg), null if not shown
  "rpe": number | null,        // null if not shown
  "rest": string | null,       // e.g. "90s", "2 min", null if not shown
  "timeSeconds": number | null // for timed work (planks, carries) instead of reps; null otherwise
}

Rules:
- One element per exercise per day — not one element per individual set. If an exercise has 4 sets of 8
  reps, that is ONE element with sets=4, reps="8".
- If different sets within one exercise have different rep targets (e.g. a pyramid), use the most common
  or first-listed target and put the full scheme in "rest" is wrong — instead just pick the first set's
  target for reps/weight; the coach can adjust individual sets after import.
- Preserve the exercise names and day/week labels exactly as written — do not rename, translate, or
  "correct" an exercise name.
- Respond with ONLY the JSON array. No markdown code fences, no explanation, no leading or trailing text.
- If the image contains no readable workout data at all, respond with exactly: []`;

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
      { error: "The AI photo importer isn't configured yet — ask your admin to add an ANTHROPIC_API_KEY." },
      { status: 503 }
    );
  }

  const { imageBase64, mediaType } = await request.json();
  if (!imageBase64 || !mediaType) {
    return NextResponse.json({ error: "Missing imageBase64 or mediaType" }, { status: 400 });
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(mediaType)) {
    return NextResponse.json(
      { error: "Unsupported image type — use a JPEG, PNG, WebP, or GIF (convert a PDF page to an image first)." },
      { status: 400 }
    );
  }

  try {
    const text = await callClaude({
      system: SYSTEM_PROMPT,
      userText: "Extract the workout program from this image as the JSON array described.",
      image: { mediaType, base64Data: imageBase64 },
      maxTokens: 8192,
    });

    const parsed = JSON.parse(extractJson(text));
    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: "AI response wasn't a JSON array — try a clearer photo." }, { status: 502 });
    }

    const rows: ParsedImportRow[] = parsed.filter(isValidRow).map((r: any) => ({
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
        { error: "Couldn't find any exercises in that image — try a clearer or better-lit photo." },
        { status: 422 }
      );
    }

    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Couldn't parse that image: ${message}` }, { status: 502 });
  }
}
