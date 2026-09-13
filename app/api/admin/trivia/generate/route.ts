import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, isAiConfigured, extractJson } from "@/lib/anthropic-client";

// Drafts a fresh batch of workout/fitness true-false trivia questions
// via AI, landing them as `status: 'pending'` for a platform admin to
// review before they ever reach a live round — the same "AI drafts,
// human approves" gate every other correctness-sensitive AI content
// bank in this app already uses. Never called by anything except this
// admin-only route; nothing generates or serves trivia unsupervised.
export async function POST(request: Request) {
  if (!isAiConfigured()) {
    return NextResponse.json({ error: "AI features aren't configured yet." }, { status: 503 });
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { data: profile } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle();
  if (!profile?.is_platform_admin) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const count = Math.min(20, Math.max(1, Number(body?.count) || 10));

  try {
    const raw = await callClaude({
      system:
        "You write true/false trivia questions about workout science, resistance training, and general " +
        "exercise physiology, for a fitness coaching app. Every statement must be a real, well-established, " +
        "verifiably correct or incorrect fact -- never invent or guess at a fact you are not confident about. " +
        'Respond with ONLY a JSON array of exactly the shape [{"statement": string, "correctAnswer": boolean}, ...] ' +
        "-- no other text, no markdown fences.",
      userText: `Write ${count} new true/false workout trivia statements.`,
      maxTokens: 2048,
    });

    const parsed = JSON.parse(extractJson(raw));
    const rows = (Array.isArray(parsed) ? parsed : [])
      .filter((q: unknown) => {
        const item = q as { statement?: unknown; correctAnswer?: unknown };
        return typeof item?.statement === "string" && item.statement.trim() && typeof item?.correctAnswer === "boolean";
      })
      .map((q: { statement: string; correctAnswer: boolean }) => ({
        category: "workout",
        statement: q.statement.trim(),
        correct_answer: q.correctAnswer,
        status: "pending",
      }));

    if (rows.length === 0) {
      return NextResponse.json({ error: "The AI response didn't contain any usable questions." }, { status: 502 });
    }

    const { error: insertError } = await supabase.from("trivia_questions").insert(rows);
    if (insertError) {
      return NextResponse.json({ error: "Generated, but couldn't save the questions." }, { status: 500 });
    }

    return NextResponse.json({ inserted: rows.length });
  } catch {
    return NextResponse.json({ error: "Couldn't generate questions — try again." }, { status: 500 });
  }
}
