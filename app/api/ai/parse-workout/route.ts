import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError, AiTruncatedError } from "@/lib/anthropic-client";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { PROGRAM_IMPORT_SYSTEM_PROMPT, planImportRequest, normalizeRows, noRowsMessage, userTextForProgramText } from "@/lib/program-import-request";
import { readInParts, partialMessage } from "@/lib/read-in-parts";
import type { ParsedImportRow } from "@/lib/workout-import-parser";

// The longest answer one read may give. A long program is a long list of exercises; 8192 cut off a routine 12-week program.
const READ_MAX_TOKENS = 16000;
// A program that still does not fit is cut in half (at a week if it can) and each half read on its own, at most twice over: five reads in all.
const MAX_SPLIT_DEPTH = 2;
// No new read is started if it would probably end after this many milliseconds from the start of the request (240 of the 300 seconds), and a typical read is guessed at 60 seconds until one is timed.
const READ_BUDGET_MS = 240_000;
const FIRST_GUESS_READ_MS = 60_000;

// A long program can take several reads one after the other. 300 seconds is the Pro plan's own limit for a function; the reading stops starting new reads well before that (see
// READ_BUDGET_MS) and hands back what it has.
export const maxDuration = 300;

// Reads a program the coach dropped into the one Build-with-AI box: a photo or screenshot ({ imageBase64, mediaType }), a PDF ({ pdfBase64 }), or pasted text ({ text }). Spreadsheets never
// come here (they are read free in the browser). Every call is metered under its own feature name.
export async function POST(request: Request) {
  const startedAt = Date.now();
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

  // Reads one piece of text with the AI. The program is only ever read from text the coach gave: nothing is guessed.
  const readOne = async (sourceText: string): Promise<ParsedImportRow[] | "not_a_list"> => {
    const text = await callClaude({
      meta: { feature: plan.ok ? plan.feature : "program_import_text", userId: user!.id },
      system: PROGRAM_IMPORT_SYSTEM_PROMPT,
      userText: userTextForProgramText(sourceText),
      maxTokens: READ_MAX_TOKENS,
    });
    const parsed = JSON.parse(extractJson(text));
    return Array.isArray(parsed) ? normalizeRows(parsed) : "not_a_list";
  };

  try {
    let rows: ParsedImportRow[];
    let parts = 1;
    let note: string | null = null;
    if ("sourceText" in plan && plan.sourceText) {
      // Cut off? Split in two and read each half, in order, but never start a read that would run past the time the server allows: hand back what was read instead.
      const read = await readInParts(plan.sourceText, {
        read: readOne,
        isTruncated: (e) => e instanceof AiTruncatedError,
        now: Date.now,
        deadlineAt: startedAt + READ_BUDGET_MS,
        defaultReadMs: FIRST_GUESS_READ_MS,
        maxDepth: MAX_SPLIT_DEPTH,
      });
      if (read === "not_a_list") return NextResponse.json({ error: "The reader's answer wasn't a program list. Try again, or try a clearer copy." }, { status: 502 });
      rows = read.rows;
      parts = read.parts;
      if (read.stoppedEarly && rows.length > 0) note = partialMessage(rows);
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

    return NextResponse.json({ rows, parts, note });
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
