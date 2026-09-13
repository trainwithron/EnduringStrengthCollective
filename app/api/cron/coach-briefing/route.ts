import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callClaude, extractJson, isAiConfigured } from "@/lib/anthropic-client";
import { gatherCandidateSignals, type CandidateSignal } from "@/lib/coach-briefing-gather";
import { validateNoHallucinatedNumbers, validateNoNumbers } from "@/lib/coach-briefing-numeral-guard";
import { enforceReservedQuietSlot } from "@/lib/coach-briefing-reserved-slot";

// AI Assistant Slice 2 ("Collective Intelligence" — The Briefing). Same
// CRON_SECRET/service-role shape as every other cron in this app. One
// Claude call per coach per day, synthesizing the same signals the
// dashboard hero already computes into a short, cited, 3-item-max
// briefing. Deliberately skips the Claude call entirely on a genuinely
// quiet day (zero eligible candidates) — the surest way to guarantee
// "an empty day is zero items, never manufactured content" is to never
// hand the model an empty canvas to fill in the first place.
const MAX_ITEMS_PER_DAY = 3;

interface RawModelItem {
  item_type: "observation" | "reflective_question" | "celebration";
  headline: string;
  signal_ids: string[];
}

const SYSTEM_PROMPT = `You are Collective Intelligence, a feature inside a strength-coaching platform that synthesizes real, already-computed signals about a coach's clients into a short daily briefing.

Governing rule, non-negotiable: you may only state a VERIFIED FACT (an "observation" or "celebration" item, which may include real numbers drawn ONLY from the signals you're given) or ask a REFLECTIVE QUESTION (which must never contain any number and must never assert an inferred cause, diagnosis, or judgment — only invite the coach to look into it themselves).

Rules:
- Return at most ${MAX_ITEMS_PER_DAY} items total, even if more signals are provided. Pick the ones most worth a coach's attention.
- Every item MUST include "signal_ids": an array of one or more of the exact signal ids you were given that this item is based on. Never invent a signal id.
- "observation" and "celebration" items may state real numbers, but ONLY numbers that appear in the cited signals' own descriptions. Never compute, round, or introduce a number that isn't already present in a cited signal's description.
- "reflective_question" items must contain zero numbers and must phrase things as a question, never an assertion about why something is happening.
- Never combine multiple athletes into one item.
- Respond with ONLY a JSON array of items, no other text, no markdown fence. Each item: {"item_type": "observation" | "reflective_question" | "celebration", "headline": "...", "signal_ids": ["..."]}.`;

function buildUserPrompt(candidates: CandidateSignal[]): string {
  const lines = candidates.map(
    (c) => `- id: "${c.id}" | athlete: ${c.athleteName} | signal: ${c.kind} | fact: ${c.description}`
  );
  return `Here are today's eligible signals for this coach's roster:\n\n${lines.join("\n")}\n\nReturn the JSON array now.`;
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const todayKey = new Date().toISOString().slice(0, 10);

  const { data: coachMemberships } = await supabase
    .from("group_memberships")
    .select("profile_id, group_id")
    .eq("role", "coach");

  const groupIdsByCoach = new Map<string, string[]>();
  for (const row of coachMemberships ?? []) {
    const list = groupIdsByCoach.get(row.profile_id) ?? [];
    list.push(row.group_id);
    groupIdsByCoach.set(row.profile_id, list);
  }

  const results: { coachId: string; itemCount: number; skipped: string | null }[] = [];

  for (const [coachId, groupIds] of groupIdsByCoach) {
    // Idempotent per day — a re-run (retry, manual trigger) never
    // double-generates.
    const { data: existing } = await supabase
      .from("coach_briefings")
      .select("id")
      .eq("coach_id", coachId)
      .eq("briefing_date", todayKey)
      .maybeSingle();
    if (existing) {
      results.push({ coachId, itemCount: 0, skipped: "already generated today" });
      continue;
    }

    const candidates = await gatherCandidateSignals(supabase, { coachId, groupIds });

    const { data: briefing } = await supabase
      .from("coach_briefings")
      .insert({ coach_id: coachId, briefing_date: todayKey })
      .select("id")
      .single();
    if (!briefing) {
      results.push({ coachId, itemCount: 0, skipped: "failed to create briefing row" });
      continue;
    }

    if (candidates.length === 0) {
      results.push({ coachId, itemCount: 0, skipped: "no eligible signals today" });
      continue;
    }

    if (!isAiConfigured()) {
      results.push({ coachId, itemCount: 0, skipped: "AI not configured" });
      continue;
    }

    let rawItems: RawModelItem[] = [];
    try {
      const responseText = await callClaude({
        system: SYSTEM_PROMPT,
        userText: buildUserPrompt(candidates),
        maxTokens: 1024,
      });
      const parsed = JSON.parse(extractJson(responseText));
      if (Array.isArray(parsed)) rawItems = parsed.slice(0, MAX_ITEMS_PER_DAY);
    } catch {
      results.push({ coachId, itemCount: 0, skipped: "generation or parse failure" });
      continue;
    }

    const candidatesById = new Map(candidates.map((c) => [c.id, c]));
    const validatedItems: { itemType: RawModelItem["item_type"]; headline: string; signalIds: string[] }[] = [];
    for (const item of rawItems) {
      if (!item || typeof item.headline !== "string" || !Array.isArray(item.signal_ids) || item.signal_ids.length === 0) {
        continue;
      }
      const citedCandidates = item.signal_ids.map((id) => candidatesById.get(id)).filter((c): c is CandidateSignal => !!c);
      if (citedCandidates.length !== item.signal_ids.length) continue; // cited an id it was never given

      if (item.item_type === "reflective_question") {
        if (!validateNoNumbers(item.headline)) continue;
      } else if (item.item_type === "observation" || item.item_type === "celebration") {
        const allowedValues = citedCandidates.flatMap((c) => c.numericValues);
        if (!validateNoHallucinatedNumbers(item.headline, allowedValues).valid) continue;
      } else {
        continue;
      }
      validatedItems.push({ itemType: item.item_type, headline: item.headline, signalIds: item.signal_ids });
    }

    const finalItems = enforceReservedQuietSlot(
      validatedItems,
      candidates.map((c) => ({ id: c.id, description: c.description, isStrongQuietTier: c.isStrongQuietTier })),
      MAX_ITEMS_PER_DAY
    ).slice(0, MAX_ITEMS_PER_DAY);

    if (finalItems.length > 0) {
      await supabase.from("coach_briefing_items").insert(
        finalItems.map((item, index) => {
          const firstSignal = candidatesById.get(item.signalIds[0]);
          return {
            briefing_id: briefing.id,
            athlete_id: firstSignal?.athleteId,
            group_id: firstSignal?.groupId,
            item_type: item.itemType,
            headline: item.headline,
            signal_ids: item.signalIds,
            sort_order: index,
          };
        })
      );
    }

    results.push({ coachId, itemCount: finalItems.length, skipped: null });
  }

  return NextResponse.json({ coaches: results.length, results });
}
