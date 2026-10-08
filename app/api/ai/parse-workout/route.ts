import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { PROGRAM_IMPORT_SYSTEM_PROMPT, planImportRequest, normalizeRows, noRowsMessage } from "@/lib/program-import-request";

// A scanned PDF with an 8192-token answer can run well past a default function limit; the other AI routes allow the same.
export const maxDuration = 120;

// Reads a program the coach dropped into the one Build-with-AI box: a photo or screenshot ({ imageBase64, mediaType }), a PDF ({ pdfBase64 }), or pasted text ({ text }). Spreadsheets never
// come here (they are read free in the browser). Every call is metered under its own feature name.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Only a coach can import a program. A client's call would be billed to their coach's budget.
  const { data: coachRow } = await supabase.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach").limit(1).maybeSingle();
  if (!coachRow) return NextResponse.json({ error: "Only coaches can import programs." }, { status: 403 });

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "The AI program reader isn't available yet." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request couldn't be read." }, { status: 400 });
  }

  const plan = await planImportRequest(body);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: plan.status });

  try {
    const text = await callClaude({
      meta: { feature: plan.feature, userId: user.id },
      system: PROGRAM_IMPORT_SYSTEM_PROMPT,
      userText: plan.userText,
      image: plan.feature === "program_import_photo" ? plan.image : undefined,
      document: plan.feature === "program_import_pdf" ? plan.document : undefined,
      maxTokens: 8192,
    });

    const parsed = JSON.parse(extractJson(text));
    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: "The reader's answer wasn't a program list. Try again, or try a clearer copy." }, { status: 502 });
    }

    const rows = normalizeRows(parsed);
    if (rows.length === 0) return NextResponse.json({ error: noRowsMessage(plan.feature) }, { status: 422 });

    return NextResponse.json({ rows });
  } catch (err) {
    if (err instanceof AiRateLimitedError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    // The provider's own message (billing, overload) is for the log, not for the coach.
    console.error("parse-workout failed", err);
    return NextResponse.json({ error: "Couldn't read that right now. Try again, or paste the program as text." }, { status: 502 });
  }
}
