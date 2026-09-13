import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaude, extractJson, isAiConfigured } from "@/lib/anthropic-client";
import { validateNoHallucinatedNumbers, validateNoNumbers } from "@/lib/coach-briefing-numeral-guard";
import { validateNoUnresolvedAthleteNames } from "@/lib/coach-chat-name-guard";
import {
  resolveAthleteByName,
  getRosterFullNames,
  getLastSessionSummary,
  getExerciseTrend,
  getReadinessHistory,
  getLoggingConsistency,
  getRosterLoggingThisWeek,
  getGoalAndNutritionPhaseStatus,
  type LookupResult,
} from "@/lib/collective-intelligence-lookups";

// AI Assistant Phase 2 — Collective Intelligence conversational chat
// (collective_intelligence_phase_2_conversational_assistant.md). Two real
// AI calls, not one: a small router call decides which whitelisted
// lookups to run (never reasons over data itself), then a synthesis call
// answers using only what those lookups actually returned. No streaming —
// the numeral/name guards have to see the whole answer before the coach
// does.
const MAX_LOOKUPS_PER_TURN = 3;
const MAX_HISTORY_MESSAGES = 20;

const LOOKUP_NAMES = [
  "last_session_summary",
  "exercise_trend",
  "readiness_history",
  "logging_consistency",
  "roster_logging_this_week",
  "goal_and_nutrition_phase",
] as const;
type LookupName = (typeof LOOKUP_NAMES)[number];

interface RouterLookupRequest {
  name: string;
  athleteName?: string;
  exerciseName?: string;
  windowDays?: number;
}

const ROUTER_SYSTEM_PROMPT = `You are the routing layer for Collective Intelligence, a strength-coaching platform's conversational assistant. You never state facts yourself — you only decide which of these whitelisted lookup functions (if any) should run to answer the coach's question:

- last_session_summary(athleteName): that athlete's most recent logged workout.
- exercise_trend(athleteName, exerciseName): how one athlete's RPE/weight has trended on one specific exercise.
- readiness_history(athleteName, windowDays): that athlete's average sleep/soreness/energy readiness over a window of days (default 30).
- logging_consistency(athleteName): how recently/consistently that athlete has been logging workouts.
- roster_logging_this_week(): how many of the coach's own clients have logged a workout in the last 7 days.
- goal_and_nutrition_phase(athleteName): that athlete's current confirmed goal and nutrition phase.

Rules:
- Return at most ${MAX_LOOKUPS_PER_TURN} lookups.
- Only request a lookup if it's actually needed to answer the question. A greeting or a general question needs zero lookups.
- Never invent an athleteName not plausibly mentioned by the coach.
- Respond with ONLY a JSON object, no other text: {"lookups": [{"name": "...", "athleteName": "...", "exerciseName": "...", "windowDays": 30}]} — omit fields a lookup doesn't need.`;

const SYNTHESIS_SYSTEM_PROMPT = `You are Collective Intelligence, a conversational assistant inside a strength-coaching platform, answering a coach's question about their own clients.

Governing rule, non-negotiable: you may only state a VERIFIED FACT using numbers that appear in the "Retrieved facts" you're given below, or ask a REFLECTIVE QUESTION (which must never contain a number and must never assert an inferred cause, diagnosis, or judgment).

Rules:
- You may only mention an athlete by name if they appear in "Athletes you may reference" below. Never volunteer a different client's name, even to compare.
- If the retrieved facts don't cover what the coach asked, say so plainly rather than guessing.
- Respond with ONLY a JSON object, no other text: {"answer_parts": [{"type": "fact" | "question", "text": "..."}]}. Usually 1-3 parts.`;

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

  const { data: coachMembership } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();
  if (!coachMembership) {
    return NextResponse.json({ error: "Only coaches can use Collective Intelligence chat." }, { status: 403 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "AI features aren't configured yet." }, { status: 503 });
  }

  const body = await request.json();
  const message: string = body.message;
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  let threadId: string = body.threadId;
  if (!threadId) {
    const { data: newThread } = await supabase
      .from("coach_chat_threads")
      .insert({ coach_id: user.id })
      .select("id")
      .single();
    if (!newThread) return NextResponse.json({ error: "Couldn't start a new chat thread." }, { status: 500 });
    threadId = newThread.id;
  }

  const { data: priorMessages } = await supabase
    .from("coach_chat_messages")
    .select("role, body")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(MAX_HISTORY_MESSAGES);
  const history = priorMessages ?? [];

  // Step 1 — router. Decides WHAT to look up; never states a fact itself.
  let requestedLookups: RouterLookupRequest[] = [];
  try {
    const routerResponse = await callClaude({
      system: ROUTER_SYSTEM_PROMPT,
      userText: `${buildHistoryText(history)}Coach's new question: ${message}`,
      maxTokens: 512,
    });
    const parsed = JSON.parse(extractJson(routerResponse));
    if (Array.isArray(parsed.lookups)) requestedLookups = parsed.lookups.slice(0, MAX_LOOKUPS_PER_TURN);
  } catch {
    requestedLookups = [];
  }

  // Step 2 — execute only whitelisted lookups, resolving athlete names
  // deterministically (never trusting the router's own guess of who a
  // name resolves to).
  const results: LookupResult[] = [];
  const resolvedNamesThisTurn = new Set<string>();
  for (const req of requestedLookups) {
    if (!LOOKUP_NAMES.includes(req.name as LookupName)) continue;
    const name = req.name as LookupName;

    if (name === "roster_logging_this_week") {
      const result = await getRosterLoggingThisWeek(supabase, user.id);
      if (result) results.push(result);
      continue;
    }

    if (!req.athleteName) continue;
    const resolution = await resolveAthleteByName(supabase, { coachId: user.id, name: req.athleteName });
    if (resolution === "not_found") {
      results.push({
        description: `No client matching "${req.athleteName}" was found on this coach's roster.`,
        numericValues: [],
        athleteNamesReferenced: [],
      });
      continue;
    }
    if (resolution === "ambiguous") {
      results.push({
        description: `More than one client on this roster matches "${req.athleteName}" — ask the coach to be more specific (e.g. a last name).`,
        numericValues: [],
        athleteNamesReferenced: [],
      });
      continue;
    }
    resolvedNamesThisTurn.add(resolution.fullName);

    let result: LookupResult | null = null;
    if (name === "last_session_summary") result = await getLastSessionSummary(supabase, resolution);
    else if (name === "exercise_trend" && req.exerciseName)
      result = await getExerciseTrend(supabase, resolution, req.exerciseName);
    else if (name === "readiness_history")
      result = await getReadinessHistory(supabase, resolution, req.windowDays ?? 30);
    else if (name === "logging_consistency") result = await getLoggingConsistency(supabase, resolution);
    else if (name === "goal_and_nutrition_phase") result = await getGoalAndNutritionPhaseStatus(supabase, resolution);

    if (result) results.push(result);
  }

  // Rebuilt fresh every turn, from only this turn's own lookups — never
  // carried forward from earlier turns (the guard must never quietly stop
  // checking anything meaningful by turn ten of a conversation).
  const allowedNumbers = results.flatMap((r) => r.numericValues);
  const rosterFullNames = await getRosterFullNames(supabase, user.id);
  const referenceableNames = [...new Set(results.flatMap((r) => r.athleteNamesReferenced))];

  const factsText =
    results.length > 0
      ? results.map((r) => `- ${r.description}`).join("\n")
      : "(No lookups were relevant to this question.)";

  let answerParts: { type: "fact" | "question"; text: string }[] = [];
  try {
    const synthesisResponse = await callClaude({
      system: SYNTHESIS_SYSTEM_PROMPT,
      userText: `${buildHistoryText(history)}Retrieved facts:\n${factsText}\n\nAthletes you may reference: ${
        referenceableNames.length > 0 ? referenceableNames.join(", ") : "(none)"
      }\n\nCoach's question: ${message}\n\nReturn the JSON now.`,
      maxTokens: 1024,
    });
    const parsed = JSON.parse(extractJson(synthesisResponse));
    if (Array.isArray(parsed.answer_parts)) answerParts = parsed.answer_parts;
  } catch {
    answerParts = [];
  }

  const validParts = answerParts.filter((part) => {
    if (!part || typeof part.text !== "string") return false;
    const nameCheck = validateNoUnresolvedAthleteNames(part.text, [...resolvedNamesThisTurn], rosterFullNames);
    if (!nameCheck.valid) return false;
    if (part.type === "question") return validateNoNumbers(part.text);
    if (part.type === "fact") return validateNoHallucinatedNumbers(part.text, allowedNumbers).valid;
    return false;
  });

  const answer =
    validParts.length > 0
      ? validParts.map((p) => p.text).join(" ")
      : "I wasn't able to verify a confident answer to that — try asking about a specific client or exercise.";

  const lookupsUsed = requestedLookups
    .filter((r) => LOOKUP_NAMES.includes(r.name as LookupName))
    .map((r) => r.name);

  // Both rows must share the same key set — PostgREST builds one column
  // list for a batch insert, and a key present on only one row inserts
  // NULL (not the column default) for the row that omits it, which
  // silently fails the whole batch against lookups_used's NOT NULL
  // constraint.
  const { error: insertError } = await supabase.from("coach_chat_messages").insert([
    { thread_id: threadId, coach_id: user.id, role: "coach", body: message, lookups_used: [] },
    { thread_id: threadId, coach_id: user.id, role: "assistant", body: answer, lookups_used: lookupsUsed },
  ]);
  if (insertError) {
    console.error("Failed to persist Collective Intelligence chat messages:", insertError);
  }
  await supabase.from("coach_chat_threads").update({ last_message_at: new Date().toISOString() }).eq("id", threadId);

  return NextResponse.json({ threadId, answer });
}
