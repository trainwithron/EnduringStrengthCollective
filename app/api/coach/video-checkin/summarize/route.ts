import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, isAiConfigured, AiNotConfiguredError, extractJson } from "@/lib/anthropic-client";

// Turns a coach's rough, typed bullet notes (jotted during/after
// recording a video check-in) into a polished summary + a real action
// list — same callClaude mechanism already proven for AI-generated
// programs, just a different input/output shape. Deliberately takes
// typed notes, not the video's audio: full transcription isn't a proven
// input shape for this app's AI integration yet (see the migration's own
// header comment).
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

  const body = await request.json();
  const groupId: string | undefined = body?.groupId;
  const notes: string | undefined = body?.notes;
  if (!groupId || !notes || !notes.trim()) {
    return NextResponse.json({ error: "Missing groupId or notes." }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Only a coach can generate a check-in summary." }, { status: 403 });
  }

  try {
    const raw = await callClaude({
      system:
        "You are a fitness coach's assistant. The coach will give you rough, informal notes " +
        "jotted during or after a video check-in with a client. Turn them into (1) a short, " +
        "polished summary paragraph in a warm, direct coaching voice, and (2) a real, concrete " +
        "action-item checklist for the client (2-6 items, each a short imperative phrase). " +
        "Respond with ONLY a JSON object of the exact shape " +
        '{"summary": string, "actionItems": string[]} — no other text, no markdown fences.',
      userText: notes,
      maxTokens: 1024,
    });

    const parsed = JSON.parse(extractJson(raw));
    const summary = typeof parsed.summary === "string" ? parsed.summary : "";
    const actionItems: string[] = Array.isArray(parsed.actionItems)
      ? parsed.actionItems.filter((i: unknown) => typeof i === "string" && i.trim())
      : [];

    return NextResponse.json({ summary, actionItems });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("video-checkin summarize error:", err);
    return NextResponse.json({ error: "Couldn't generate a summary — try again." }, { status: 500 });
  }
}
