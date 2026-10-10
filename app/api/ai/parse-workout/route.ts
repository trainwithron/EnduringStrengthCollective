import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError, AiTruncatedError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { PROGRAM_IMPORT_SYSTEM_PROMPT, planImportRequest, normalizeRows, noRowsMessage, userTextForProgramText } from "@/lib/program-import-request";
import { splitProgramText } from "@/lib/program-text-split";
import type { ParsedImportRow } from "@/lib/workout-import-parser";

// The longest answer one read may give. A long program is a long list of exercises; 8192 cut off a routine 12-week program.
const READ_MAX_TOKENS = 32000;
// A program that still does not fit is cut in half (at a week if it can) and each half read on its own, at most twice over: five reads in all.
const MAX_SPLIT_DEPTH = 2;

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

  // Reads one piece of text. If the answer is cut off (the program is too long for one answer) the text is split in two and each half is read, so nothing is lost and nothing is
  // guessed: every row comes from text the coach gave.
  async function readText(sourceText: string, depth: number): Promise<{ rows: ParsedImportRow[]; parts: number } | "not_a_list"> {
    try {
      const text = await callClaude({
        meta: { feature: plan.ok ? plan.feature : "program_import_text", userId: user!.id },
        system: PROGRAM_IMPORT_SYSTEM_PROMPT,
        userText: userTextForProgramText(sourceText),
        maxTokens: READ_MAX_TOKENS,
      });
      const parsed = JSON.parse(extractJson(text));
      if (!Array.isArray(parsed)) return "not_a_list";
      return { rows: normalizeRows(parsed), parts: 1 };
    } catch (err) {
      if (err instanceof AiTruncatedError && depth < MAX_SPLIT_DEPTH) {
        const halves = splitProgramText(sourceText);
        if (halves) {
          const a = await readText(halves[0], depth + 1);
          if (a === "not_a_list") return a;
          const b = await readText(halves[1], depth + 1);
          if (b === "not_a_list") return b;
          return { rows: [...a.rows, ...b.rows], parts: a.parts + b.parts };
        }
      }
      throw err;
    }
  }

  try {
    let rows: ParsedImportRow[];
    let parts = 1;
    if ("sourceText" in plan && plan.sourceText) {
      const read = await readText(plan.sourceText, 0);
      if (read === "not_a_list") return NextResponse.json({ error: "The reader's answer wasn't a program list. Try again, or try a clearer copy." }, { status: 502 });
      rows = read.rows;
      parts = read.parts;
    } else {
      // A picture or a scanned PDF is looked at as it is. It cannot be cut in half here, so a very long one gets a plain message instead of a made-up one.
      const text = await callClaude({
        meta: { feature: plan.feature, userId: user.id },
        system: PROGRAM_IMPORT_SYSTEM_PROMPT,
        userText: plan.userText,
        image: plan.feature === "program_import_photo" ? plan.image : undefined,
        document: plan.feature === "program_import_pdf" ? plan.document : undefined,
        maxTokens: READ_MAX_TOKENS,
      });
      const parsed = JSON.parse(extractJson(text));
      if (!Array.isArray(parsed)) {
        return NextResponse.json({ error: "The reader's answer wasn't a program list. Try again, or try a clearer copy." }, { status: 502 });
      }
      rows = normalizeRows(parsed);
    }
    if (rows.length === 0) return NextResponse.json({ error: noRowsMessage(plan.feature) }, { status: 422 });

    return NextResponse.json({ rows, parts });
  } catch (err) {
    if (err instanceof AiTruncatedError) {
      return NextResponse.json(
        { error: "This program is too large to read in one go. Try a few weeks at a time, or paste the program as text." },
        { status: 413 }
      );
    }
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
