import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured } from "@/lib/anthropic-client";

// AI Program Builder conversational learning
// (ai_program_builder_conversational_learning_idea.md) — lets a coach ask
// "why did you do that" about a generated program, push back with a
// correction, and have the AI ask a scoping follow-up so the correction
// becomes a properly-scoped rule instead of a blanket one. Reuses the
// Collective Intelligence chat pipeline's storage (coach_chat_threads/
// messages, scoped here via the program_id column) but needs only one AI
// call per turn, not CI-chat's router-then-synthesis pair — there's
// nothing to route between here, the three inputs (program structure,
// generation notes, existing preferences) are always the same three.
const MAX_HISTORY_MESSAGES = 20;

const SYSTEM_PROMPT = `You are the AI Program Builder's assistant, helping a coach understand and refine a training program you generated for them.

Governing rule, non-negotiable: ground every "why" answer ONLY in the program's structure and your own generation notes given below. If those notes don't cover the specific thing the coach is asking about, say plainly that you don't have a specific reason recorded for that particular choice — never invent one.

Behavior:
- If the coach asks "why" about something, answer using only the generation notes and program structure provided.
- If the coach pushes back with a correction ("next time do X instead," "put this first," etc.) and it isn't yet clear when this preference should apply, ask ONE clear scoping follow-up question (e.g. "Should this apply to every program, or specifically ones focused on power/explosive work?") in your reply, and leave proposedRule null.
- Once the scope is clear (from this turn or an earlier one in the conversation), propose a structured rule: a plain-English condition and the preference that applies when it's met. Ask the coach to confirm before it's saved.
- Never claim a rule has already been saved — only the app's own UI saves it, after the coach explicitly confirms. Your job is only to propose it.
- Keep replies conversational and concise — a few sentences, not a report.

Respond with ONLY a JSON object, no other text: {"reply": "...", "proposedRule": {"condition": "...", "preference": "..."} | null}`;

function buildHistoryText(history: { role: string; body: string }[]): string {
  if (history.length === 0) return "";
  return (
    "Conversation so far:\n" +
    history.map((m) => `${m.role === "coach" ? "Coach" : "Assistant"}: ${m.body}`).join("\n") +
    "\n\n"
  );
}

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "AI features aren't configured yet." }, { status: 503 });
  }

  const body = await request.json();
  const message: string = body.message;
  const programId: string = body.programId;
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }
  if (!programId) {
    return NextResponse.json({ error: "Missing programId." }, { status: 400 });
  }

  const { data: program } = await supabase
    .from("programs")
    .select("id, name, group_id, ai_sequencing_notes")
    .eq("id", programId)
    .maybeSingle();
  if (!program) return NextResponse.json({ error: "Program not found." }, { status: 404 });

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", program.group_id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (membership?.role !== "coach") {
    return NextResponse.json({ error: "Only coaches can use the program chat." }, { status: 403 });
  }

  let threadId: string = body.threadId;
  if (!threadId) {
    const { data: existingThread } = await supabase
      .from("coach_chat_threads")
      .select("id")
      .eq("coach_id", user.id)
      .eq("program_id", programId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingThread) {
      threadId = existingThread.id;
    } else {
      const { data: newThread } = await supabase
        .from("coach_chat_threads")
        .insert({ coach_id: user.id, program_id: programId })
        .select("id")
        .single();
      if (!newThread) return NextResponse.json({ error: "Couldn't start a new chat thread." }, { status: 500 });
      threadId = newThread.id;
    }
  }

  const { data: priorMessages } = await supabase
    .from("coach_chat_messages")
    .select("role, body")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY_MESSAGES);
  const history = priorMessages ?? [];

  // Compact program structure — exercise names in week/day/order, not the
  // full set/rep/weight detail, which isn't what a "why did you sequence
  // this" question needs and would bloat the prompt on a long program.
  const { data: workoutRows } = await supabase
    .from("workouts")
    .select("id, title, week_number, day_index, group_workout_exercises ( exercise_name, exercise_order )")
    .eq("program_id", programId)
    .order("week_number", { ascending: true })
    .order("day_index", { ascending: true });

  const structureText = (workoutRows ?? [])
    .map((w: any) => {
      const exercises = (w.group_workout_exercises ?? [])
        .slice()
        .sort((a: any, b: any) => a.exercise_order - b.exercise_order)
        .map((e: any) => e.exercise_name)
        .join(", ");
      return `Week ${w.week_number}, ${w.title}: ${exercises || "(no exercises)"}`;
    })
    .join("\n");

  const { data: existingPrefs } = await supabase
    .from("coach_program_preferences")
    .select("condition_text, preference_text")
    .eq("coach_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const existingPrefsText =
    existingPrefs && existingPrefs.length > 0
      ? existingPrefs.map((p) => `- When ${p.condition_text}: ${p.preference_text}`).join("\n")
      : "(none yet)";

  let reply = "I wasn't able to answer that — try asking again.";
  let proposedRule: { condition: string; preference: string } | null = null;

  try {
    const response = await callClaude({
      system: SYSTEM_PROMPT,
      userText:
        `Program: "${program.name}"\n\n` +
        `Program structure:\n${structureText || "(no workouts yet)"}\n\n` +
        `Your own generation notes from when you built this program:\n${program.ai_sequencing_notes ?? "(none recorded)"}\n\n` +
        `This coach's existing standing preferences (from past corrections):\n${existingPrefsText}\n\n` +
        `${buildHistoryText(history)}Coach's new message: ${message}\n\nReturn the JSON now.`,
      maxTokens: 1024,
    });
    const parsed = JSON.parse(extractJson(response));
    if (typeof parsed.reply === "string" && parsed.reply.trim()) reply = parsed.reply.trim();
    if (
      parsed.proposedRule &&
      typeof parsed.proposedRule.condition === "string" &&
      typeof parsed.proposedRule.preference === "string" &&
      parsed.proposedRule.condition.trim() &&
      parsed.proposedRule.preference.trim()
    ) {
      proposedRule = {
        condition: parsed.proposedRule.condition.trim(),
        preference: parsed.proposedRule.preference.trim(),
      };
    }
  } catch {
    // reply/proposedRule keep their fallback values above.
  }

  const { error: insertError } = await supabase.from("coach_chat_messages").insert([
    { thread_id: threadId, coach_id: user.id, role: "coach", body: message, lookups_used: [] },
    { thread_id: threadId, coach_id: user.id, role: "assistant", body: reply, lookups_used: [] },
  ]);
  if (insertError) {
    console.error("Failed to persist program chat messages:", insertError);
  }
  await supabase.from("coach_chat_threads").update({ last_message_at: new Date().toISOString() }).eq("id", threadId);

  return NextResponse.json({ threadId, reply, proposedRule });
}
