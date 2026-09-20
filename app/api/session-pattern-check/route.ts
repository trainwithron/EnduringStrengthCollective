import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured } from "@/lib/anthropic-client";
import { validateNoHallucinatedNumbers } from "@/lib/coach-briefing-numeral-guard";
import { gatherSessionPatternFindings } from "@/lib/session-pattern-spotter-gather";
import { sendPushToProfile } from "@/lib/send-push";

// Session Pattern Spotter
// (habit_spotter_and_post_workout_coach_page_research_sept19.md) — runs
// right after a specific client's session completes (called fire-and-
// forget from complete-workout-button.tsx, same non-blocking pattern
// already used there for the equipment-load-ratio refresh and the
// 1-on-1 push). A real, group-scoped notification always gets written
// here (never group_id: null — see the org-dispatch notification bug
// fixed earlier tonight), so even if the push is missed, the coach's
// own notification bell recovers it.
//
// Always writes a session_pattern_checks row, whether or not anything
// fired — the "found nothing" rows are the real mechanism behind the
// "checked, clear" passive indicator on the session recap, so silence
// never reads as "the system didn't run."
const SYSTEM_PROMPT = `You are a coaching assistant inside a strength-training platform, writing ONE short, plain-language note for a coach right after their client finished a session. You are given a list of real, already-computed behavioral findings about this client's recent training pattern. Combine them into one or two sentences a coach could actually act on — never invent, round, or restate a number that isn't already written in the findings given to you. Frame everything as worth a look, never a diagnosis or a certainty. Respond with ONLY the note text, no quotes, no markdown, no preamble.`;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json();
  const { sessionId, athleteId, groupId } = body;
  if (!sessionId || !athleteId || !groupId) {
    return NextResponse.json({ error: "sessionId, athleteId, and groupId are required." }, { status: 400 });
  }

  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("profile_id")
    .eq("group_id", groupId)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();
  if (!coachMembership) return NextResponse.json({ error: "No coach found for this group." }, { status: 404 });
  const coachId = coachMembership.profile_id;

  // Idempotent per session — a retry (or a coach re-completing the same
  // session's flow) never double-fires the notification.
  const { data: existing } = await supabase
    .from("session_pattern_checks")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, alreadyChecked: true });

  const findings = await gatherSessionPatternFindings(supabase, { athleteId, groupId });

  if (findings.length === 0) {
    await supabase.from("session_pattern_checks").insert({
      session_id: sessionId,
      athlete_id: athleteId,
      group_id: groupId,
      coach_id: coachId,
      found_something: false,
    });
    return NextResponse.json({ ok: true, foundSomething: false });
  }

  let synthesisText = findings.map((f) => f.description).join(" ");
  if (isAiConfigured()) {
    try {
      const allowedValues = findings.flatMap((f) => f.numericValues);
      const userText = `Real findings for this client's recent session pattern:\n${findings.map((f) => `- ${f.description}`).join("\n")}\n\nWrite the note now.`;
      const responseText = await callClaude({ system: SYSTEM_PROMPT, userText, maxTokens: 300 });
      const candidateText = extractJson(responseText).trim();
      if (candidateText && validateNoHallucinatedNumbers(candidateText, allowedValues).valid) {
        synthesisText = candidateText;
      }
      // A hallucinated-number response silently falls back to the plain
      // deterministic sentence above rather than surfacing an error —
      // the coach still gets a real, correct note either way.
    } catch {
      // AI unavailable/failed — the plain deterministic fallback above
      // still gets a real, correct (if less polished) note through.
    }
  }

  const { error: insertError } = await supabase.from("session_pattern_checks").insert({
    session_id: sessionId,
    athlete_id: athleteId,
    group_id: groupId,
    coach_id: coachId,
    found_something: true,
    detected_signals: findings,
    synthesis_text: synthesisText,
  });
  if (insertError) return NextResponse.json({ error: "Couldn't save the check." }, { status: 500 });

  const { data: athleteProfile } = await supabase.from("profiles").select("full_name").eq("id", athleteId).maybeSingle();
  const athleteName = athleteProfile?.full_name ?? "A client";
  const linkPath = `/sessions/${sessionId}/coach-note`;

  await supabase.from("notifications").insert({
    profile_id: coachId,
    group_id: groupId,
    type: "session_pattern_note",
    body: `New note on ${athleteName}'s session`,
    link_path: linkPath,
  });
  await sendPushToProfile(supabase, coachId, "New note on a client's session", `${athleteName} — worth a look`, linkPath);

  return NextResponse.json({ ok: true, foundSomething: true });
}
