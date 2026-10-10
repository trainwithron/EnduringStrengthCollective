import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured, AiNotConfiguredError } from "@/lib/anthropic-client";
import { AiRateLimitedError, aiInputTooLong } from "@/lib/ai-usage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYSTEM_PROMPT = `You turn a coach's short reason for changing one exercise into another into ONE plain sentence they can read back and confirm.

Rules:
- Use ONLY what the coach said as the reason. Never add a reason, a body part, a condition or a number they did not say.
- The sentence must name BOTH exercises (the one the AI wrote and the one the coach prefers) and say when the preference applies, if the coach said when. If they did not say when, say it applies generally.
- Write it as an instruction to a program writer, for example: "Prefer Reverse Lunge over Walking Lunge, because it is easier on the knees."
- One sentence, under 200 characters. No markdown.
Respond with ONLY a JSON object: {"ruleText": "..."}`;

// Counts against the coach's normal AI allowance, like the program chat it is a part of.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isAiConfigured()) return NextResponse.json({ error: "AI features aren't configured yet." }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const ruleId = typeof body.ruleId === "string" && UUID.test(body.ruleId) ? body.ruleId : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!ruleId || !reason) return NextResponse.json({ error: "Tell me a little about why." }, { status: 400 });
  const tooLong = aiInputTooLong("program_chat", reason);
  if (tooLong) return NextResponse.json({ error: tooLong }, { status: 400 });

  const { data: rule } = await supabase.from("coach_learned_rules").select("from_name, to_name").eq("id", ruleId).eq("coach_id", user.id).maybeSingle();
  if (!rule) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const text = await callClaude({
      meta: { feature: "program_chat", userId: user.id },
      system: SYSTEM_PROMPT,
      userText: `The AI wrote: ${rule.from_name}\nThe coach changed it to: ${rule.to_name}\nThe coach's reason: ${reason}`,
      maxTokens: 300,
    });
    const parsed = JSON.parse(extractJson(text));
    const ruleText = typeof parsed?.ruleText === "string" ? parsed.ruleText.trim().slice(0, 300) : "";
    if (!ruleText) return NextResponse.json({ error: "I couldn't turn that into a rule. Try saying it another way." }, { status: 502 });
    return NextResponse.json({ ruleText });
  } catch (err) {
    if (err instanceof AiRateLimitedError) return NextResponse.json({ error: err.message }, { status: 429 });
    if (err instanceof AiNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: "I couldn't turn that into a rule right now. Try again." }, { status: 502 });
  }
}
