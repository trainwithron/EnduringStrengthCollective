import { NextResponse } from "next/server";
import { userBelongsToAGroup } from "@/lib/ai-nutrition-clamp";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { INBODY_SYSTEM_PROMPT, normalizeScan, sanityChecks } from "@/lib/inbody-scan";

// Reads the numbers printed on an InBody result sheet from a photo. One vision call per sheet, JSON back, never saved here: the person (or their coach) sees every number beside the photo and
// confirms or corrects it first, and the scan is written by save_body_scan from the review screen. The model only copies printed numbers with their units; this route turns them into pounds
// and litres, drops anything impossible to blank and works out the checks the review screen shows.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await userBelongsToAGroup(supabase, user.id))) return NextResponse.json({ error: "Join a group first to use this." }, { status: 403 });

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "Reading a sheet from a photo isn't available yet. You can type the numbers in." }, { status: 503 });
  }

  const { imageBase64, mediaType } = await request.json();
  if (!imageBase64 || !mediaType) {
    return NextResponse.json({ error: "Missing imageBase64 or mediaType" }, { status: 400 });
  }
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(mediaType)) {
    return NextResponse.json({ error: "Unsupported image type. Use a JPEG, PNG or WebP photo." }, { status: 400 });
  }

  try {
    const raw = await callClaude({
      meta: { feature: "inbody_scan_parse", userId: user.id },
      system: INBODY_SYSTEM_PROMPT,
      userText: "Read this InBody result sheet and return the JSON object described.",
      image: { mediaType, base64Data: imageBase64 },
      maxTokens: 1200,
    });

    const parsed = JSON.parse(extractJson(raw));
    if (parsed?.error) {
      return NextResponse.json({ error: String(parsed.error) }, { status: 422 });
    }
    const values = normalizeScan(parsed);
    return NextResponse.json({ values, checks: sanityChecks(values) });
  } catch (err) {
    if (err instanceof AiRateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: "Couldn't read that sheet. Try again, or type the numbers in." }, { status: 502 });
  }
}
