import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callClaude, extractJson, isAiConfigured } from "@/lib/anthropic-client";
import { gatherCandidateSignals, type CandidateSignal } from "@/lib/coach-briefing-gather";
import { validateNoHallucinatedNumbers, validateNoNumbers } from "@/lib/coach-briefing-numeral-guard";
import { enforceReservedQuietSlot } from "@/lib/coach-briefing-reserved-slot";
import { withCronRun } from "@/lib/cron-monitor";
import { runPool } from "@/lib/run-pool";
import { pageAll } from "@/lib/page-all";
import { readRowsByIds } from "@/lib/read-by-ids";
import { AiRateLimitedError } from "@/lib/ai-usage";
import { DEFAULT_COACH_TIMEZONE, dateKeyInZone } from "@/lib/timezone";
import { isValidTimeZone } from "@/lib/format-in-timezone";

// AI Assistant Slice 2 ("Collective Intelligence" — The Briefing). Same
// CRON_SECRET/service-role shape as every other cron in this app. One
// Claude call per coach per day, synthesizing the same signals the
// dashboard hero already computes into a short, cited, 3-item-max
// briefing. Deliberately skips the Claude call entirely on a genuinely
// quiet day (zero eligible candidates) — the surest way to guarantee
// "an empty day is zero items, never manufactured content" is to never
// hand the model an empty canvas to fill in the first place.
const MAX_ITEMS_PER_DAY = 3;

// One AI call per coach: the coaches run a few at a time (not one after another) and no new coach is started past the time budget, so a long list finishes inside the function's time and a manual re-run
// (idempotent per day) picks up whoever was left.
export const maxDuration = 300;
const COACHES_AT_ONCE = 5;
const TIME_BUDGET_MS = 270_000;

interface RawModelItem {
  item_type: "observation" | "reflective_question" | "celebration";
  headline: string;
  signal_ids: string[];
}

const SYSTEM_PROMPT = `You are the Spotter, a feature inside a strength-coaching platform that synthesizes real, already-computed signals about a coach's clients into a short daily briefing.

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

async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  // Every coach membership, a page at a time (a request returns at most 1,000 rows).
  const { rows: coachMemberships, failed: membershipsFailed } = await pageAll((from, to) =>
    supabase.from("group_memberships").select("profile_id, group_id").eq("role", "coach").order("id").range(from, to)
  );
  if (membershipsFailed) return NextResponse.json({ error: "Could not read the coaches." }, { status: 500 });

  // One briefing per coach PER ORGANIZATION: a coach who runs two organizations gets a separate briefing for each, built only from that organization's clients (the request to the AI never
  // names clients from two organizations, and each organization has its own limit of items).
  const { data: groupOrgRows } = await readRowsByIds(
    [...new Set(coachMemberships.map((r) => r.group_id as string))],
    (g) => (from, to) => supabase.from("groups").select("id, organization_id").in("id", g).order("id").range(from, to)
  );
  const orgOfGroup = new Map((groupOrgRows ?? []).map((g) => [g.id as string, (g.organization_id as string | null) ?? null]));
  const groupIdsByCoachOrg = new Map<string, { coachId: string; organizationId: string | null; groupIds: string[] }>();
  for (const row of coachMemberships) {
    const organizationId = orgOfGroup.get(row.group_id) ?? null;
    // A personal space belongs to no organization and has no clients: it is not briefed.
    if (!organizationId) continue;
    const key = `${row.profile_id}|${organizationId ?? "none"}`;
    const entry = groupIdsByCoachOrg.get(key) ?? { coachId: row.profile_id as string, organizationId, groupIds: [] };
    entry.groupIds.push(row.group_id);
    groupIdsByCoachOrg.set(key, entry);
  }

  // The briefing's date is the coach's own day (their profile time zone), the same day the dashboard looks for, so a coach in the evening still sees this morning's briefing instead of
  // looking for tomorrow's. One read of every coach's zone, not one per coach.
  const coachIds = [...new Set([...groupIdsByCoachOrg.values()].map((e) => e.coachId))];
  const zoneByCoach = new Map<string, string>();
  const { data: zoneRows, error: zoneError } = await readRowsByIds(coachIds, (g) => (from, to) => supabase.from("profiles").select("id, timezone").in("id", g).order("id").range(from, to));
  // If the zones cannot be read, no briefing is made today rather than every coach being given New York's day (a coach in another zone would get a briefing the dashboard never looks for).
  if (zoneError) return NextResponse.json({ error: "Could not read the coaches' time zones." }, { status: 500 });
  for (const row of zoneRows) zoneByCoach.set(row.id as string, isValidTimeZone(row.timezone as string | null) ? (row.timezone as string) : DEFAULT_COACH_TIMEZONE);

  const results: { coachId: string; itemCount: number; skipped: string | null }[] = [];

  const processOne = async ({ coachId, organizationId, groupIds }: { coachId: string; organizationId: string | null; groupIds: string[] }): Promise<void> => {
    const timeZone = zoneByCoach.get(coachId) ?? DEFAULT_COACH_TIMEZONE;
    const todayKey = dateKeyInZone(timeZone);
    // Idempotent per day and organization — a re-run (retry, manual trigger) never double-generates.
    let existingQuery = supabase.from("coach_briefings").select("id").eq("coach_id", coachId).eq("briefing_date", todayKey);
    existingQuery = organizationId ? existingQuery.eq("organization_id", organizationId) : existingQuery.is("organization_id", null);
    const { data: existing } = await existingQuery.maybeSingle();
    if (existing) {
      results.push({ coachId, itemCount: 0, skipped: "already generated today" });
      return;
    }

    // AI off (no key, or AI_DISABLED): leave no row behind, so switching it back on the same day still generates.
    if (!isAiConfigured()) {
      results.push({ coachId, itemCount: 0, skipped: "AI not configured" });
      return;
    }

    const candidates = await gatherCandidateSignals(supabase, { coachId, groupIds, timeZone });

    const { data: briefing } = await supabase
      .from("coach_briefings")
      .insert({ coach_id: coachId, briefing_date: todayKey, organization_id: organizationId })
      .select("id")
      .single();
    if (!briefing) {
      results.push({ coachId, itemCount: 0, skipped: "failed to create briefing row" });
      return;
    }

    if (candidates.length === 0) {
      results.push({ coachId, itemCount: 0, skipped: "no eligible signals today" });
      return;
    }

    if (!isAiConfigured()) {
      results.push({ coachId, itemCount: 0, skipped: "AI not configured" });
      return;
    }

    let rawItems: RawModelItem[] = [];
    try {
      const responseText = await callClaude({
        meta: { feature: "coach_briefing", coachId },
        system: SYSTEM_PROMPT,
        userText: buildUserPrompt(candidates),
        maxTokens: 1024,
      });
      const parsed = JSON.parse(extractJson(responseText));
      if (Array.isArray(parsed)) rawItems = parsed.slice(0, MAX_ITEMS_PER_DAY);
    } catch (err) {
      // Take the empty briefing row back so tomorrow's run (or a retry today) tries again instead of reading "already generated today".
      const { error: deleteError } = await supabase.from("coach_briefings").delete().eq("id", briefing.id);
      if (deleteError) console.error("coach-briefing: could not remove the empty briefing row, a retry today will be skipped:", deleteError.message);
      // A coach whose AI budget for the month is used up is skipped, not failed (the coach was told once when it ran out), and the run resumes by itself on the 1st.
      const budgetOut = err instanceof AiRateLimitedError && err.reason === "budget_out";
      results.push({ coachId, itemCount: 0, skipped: budgetOut ? "AI budget used up this month" : "generation or parse failure" });
      return;
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
  };

  const run = await runPool([...groupIdsByCoachOrg.values()], COACHES_AT_ONCE, processOne, { deadlineMs: TIME_BUDGET_MS });
  for (const entry of run.notStarted) results.push({ coachId: entry.coachId, itemCount: 0, skipped: "out of time before this one was reached" });
  for (const failure of run.failed) results.push({ coachId: failure.item.coachId, itemCount: 0, skipped: "generation or parse failure" });



  return NextResponse.json({ coaches: results.length, results });
}

export const GET = withCronRun("coach-briefing", handler);
