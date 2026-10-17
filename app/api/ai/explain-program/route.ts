import { NextResponse } from "next/server";
import { MAX_RULE_TEXT } from "@/lib/ai-nutrition-clamp";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, isAiConfigured } from "@/lib/anthropic-client";
import { AiRateLimitedError, aiInputTooLong } from "@/lib/ai-usage";
import { answerConcisely, cleanThread, explainSettings, threadText } from "@/lib/explain-program";

export const maxDuration = 60;

// "Ask why" beside the AI Program Builder: one short explanation of the program on screen. It never changes the program. Counted with the program chat's allowance.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isAiConfigured()) return NextResponse.json({ error: "AI features aren't configured yet." }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const programId = typeof body.programId === "string" ? body.programId : "";
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  const askedFor = typeof body.request === "string" ? body.request.slice(0, 2000) : "";
  const changes: string[] = Array.isArray(body.corrections) ? body.corrections.filter((c: unknown) => typeof c === "string").map((c: string) => c.slice(0, 500)).slice(0, 20) : [];
  const thread = cleanThread(body.thread);
  if (!programId || !question) return NextResponse.json({ error: "Missing question." }, { status: 400 });
  const tooLong = aiInputTooLong("program_chat", question);
  if (tooLong) return NextResponse.json({ error: tooLong }, { status: 400 });

  const { data: program } = await supabase.from("programs").select("id, name, group_id, ai_sequencing_notes").eq("id", programId).maybeSingle();
  if (!program) return NextResponse.json({ error: "Program not found." }, { status: 404 });
  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", program.group_id).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "coach") return NextResponse.json({ error: "Only coaches can ask about a program." }, { status: 403 });

  const [{ data: workoutRows }, { data: prefs }] = await Promise.all([
    supabase
      .from("workouts")
      .select("title, week_number, day_index, group_workout_exercises ( exercise_name, exercise_order, group_workout_exercise_sets ( target_reps, target_time_seconds ) )")
      .eq("program_id", programId)
      .order("week_number", { ascending: true })
      .order("day_index", { ascending: true }),
    supabase.from("coach_program_preferences").select("condition_text, preference_text").eq("coach_id", user.id).order("created_at", { ascending: false }).limit(30),
  ]);
  const structure = ((workoutRows ?? []) as any[])
    .map((w) => {
      const items = ((w.group_workout_exercises ?? []) as any[])
        .slice()
        .sort((a, b) => a.exercise_order - b.exercise_order)
        .map((e) => {
          const sets = (e.group_workout_exercise_sets ?? []) as any[];
          const first = sets[0];
          const what = first?.target_time_seconds ? `${first.target_time_seconds}s` : first?.target_reps ? `${sets.length}x${first.target_reps}` : "";
          return `${e.exercise_name}${what ? " " + what : ""}`;
        });
      return `Week ${w.week_number}, Day ${w.day_index} (${w.title}): ${items.join("; ") || "no exercises"}`;
    })
    .join("\n");
  const prefsText = (prefs ?? []).length > 0 ? (prefs ?? []).map((p: any) => `- When ${String(p.condition_text).slice(0, MAX_RULE_TEXT)}: ${String(p.preference_text).slice(0, MAX_RULE_TEXT)}`).join("\n") : "(none)";

  try {
    const answer = await answerConcisely((strict) => {
      const settings = explainSettings(thread, strict);
      return callClaude({ retryOnTruncation: false,
      meta: { feature: "program_chat", userId: user.id },
      system: settings.system,
      userText:
        `Program: "${program.name}"\n\nProgram as shown:\n${structure || "(no days yet)"}\n\n` +
        `What the coach asked for:\n${askedFor || "(not recorded)"}\n\n` +
        `Changes the coach asked for since:\n${changes.length > 0 ? changes.map((c) => "- " + c).join("\n") : "(none)"}\n\n` +
        `What the coach has taught the builder before:\n${prefsText}\n\n` +
        `Your own notes from building it:\n${program.ai_sequencing_notes ?? "(none recorded)"}\n\n` +
        (thread.length > 0 ? `Earlier in this conversation:\n${threadText(thread)}\n\n` : "") +
        `The coach's question: ${question}`,
      maxTokens: settings.maxTokens,
      timeoutMs: 45_000,
      });
    });
    if (!answer) return NextResponse.json({ error: "Couldn't answer that. Try again." }, { status: 502 });
    return NextResponse.json({ answer });
  } catch (err) {
    if (err instanceof AiRateLimitedError) return NextResponse.json({ error: err.message }, { status: 429 });
    return NextResponse.json({ error: "Couldn't answer that. Try again." }, { status: 502 });
  }
}
