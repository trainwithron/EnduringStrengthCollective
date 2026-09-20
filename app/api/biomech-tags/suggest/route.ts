import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, isAiConfigured, extractJson, AiNotConfiguredError, AiTruncatedError } from "@/lib/anthropic-client";
import { parseBiomechTagSuggestions } from "@/lib/biomech-tag-suggestions";

// AI-assisted suggest-and-confirm biomech-tag classifier
// (biomech_redundancy_tagging_backfill_scoping_sept19.md). One call per
// exercise NAME (matches exercise_biomech_tags's own name-keyed, shared-
// across-coaches design) against the real, fixed 59-tag vocabulary —
// governed by the identical never-auto-assign contract
// lib/equipment-classifier.ts already established: this route only ever
// returns a suggestion; nothing here writes to exercise_biomech_tags.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("profile_id", user.id)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();
  if (!coachMembership) return NextResponse.json({ error: "Coach access required." }, { status: 403 });

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "AI isn't configured on this server yet." }, { status: 503 });
  }

  const body = await request.json();
  const exerciseName: string = body.exerciseName;
  if (!exerciseName || typeof exerciseName !== "string" || !exerciseName.trim()) {
    return NextResponse.json({ error: "exerciseName is required." }, { status: 400 });
  }

  const { data: vocabRows } = await supabase
    .from("biomech_tags")
    .select("id, kind, key, label, joint, description");
  const vocabulary = vocabRows ?? [];
  if (vocabulary.length === 0) return NextResponse.json({ suggestions: [] });

  const vocabText = vocabulary
    .map((t) => `- ${t.key} (${t.kind}${t.joint ? `, ${t.joint}` : ""}): ${t.label} — ${t.description}`)
    .join("\n");

  try {
    const text = await callClaude({
      system:
        "You are a biomechanics-literate strength coach classifying which joint actions and stabilization demands a named resistance-training exercise involves. Only use tag keys that appear in the vocabulary given — never invent a key. Respond with ONLY a JSON array, no prose, no markdown fence, each item shaped exactly {\"key\": \"<tag key>\", \"role\": \"prime_mover\" or \"stabilizer_demand\"}. prime_mover = a joint action this exercise directly, intentionally trains through a real range of motion. stabilizer_demand = a joint or region that must resist unwanted movement while performing it, without moving through it. Be realistic and selective — most exercises have roughly 2-5 prime movers and 1-3 stabilizer demands, not most of the vocabulary.",
      userText: `Vocabulary:\n${vocabText}\n\nExercise: ${exerciseName.trim()}`,
      maxTokens: 1024,
    });

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(extractJson(text));
    } catch {
      return NextResponse.json({ error: "AI response wasn't valid JSON — try again." }, { status: 502 });
    }

    const validKeys = new Set(vocabulary.map((t) => t.key));
    const suggestions = parseBiomechTagSuggestions(parsedJson, validKeys);
    const idByKey = new Map(vocabulary.map((t) => [t.key, t.id]));

    return NextResponse.json({
      suggestions: suggestions.map((s) => ({
        tagId: idByKey.get(s.key)!,
        role: s.role,
        label: vocabulary.find((t) => t.key === s.key)?.label ?? s.key,
      })),
    });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: "AI isn't configured on this server yet." }, { status: 503 });
    }
    if (e instanceof AiTruncatedError) {
      return NextResponse.json({ error: "AI response was cut off — try again." }, { status: 502 });
    }
    return NextResponse.json({ error: "Couldn't get suggestions — try again." }, { status: 500 });
  }
}
