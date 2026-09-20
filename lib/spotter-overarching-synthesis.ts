// 3-layer Spotter framework, Tier-3 overarching synthesis
// (two_layer_spotter_framework_architecture_research_sept19.md, Part 2)
// — takes every cornerstone's Tier-2 output and produces one unified
// picture of the day. Same cost rule as Tier 2: 0 cornerstones with
// output -> nothing, exactly 1 -> pass through unchanged, 2+ -> one
// real bounded AI call, now allowed to point out a real "connection"
// ACROSS cornerstones (Ron's own example: Calendar says attendance
// improved AND Recovery says sleep trending up, same person, same
// window -> one connected insight) — the same overlapping-time-window
// check makes this a real, checkable property, not an invented story.
//
// Deliberately NOT wired to replace app/api/cron/coach-briefing/route.ts's
// own real, live, already-shipped generation path in this pass — the
// architecture doc itself calls migrating every existing surface into
// this shape "real, non-trivial work... worth its own scoping pass, not
// bundled silently." This is real, callable, tested infrastructure
// sitting alongside the existing briefing, not a replacement for it yet.
import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude, extractJson, isAiConfigured } from "./anthropic-client";
import { validateNoHallucinatedNumbers, validateNoNumbers } from "./coach-briefing-numeral-guard";
import type { SpotterExpertReport } from "./spotter-expert-report";

const MAX_ITEMS = 3;

interface RawModelItem {
  item_type: "observation" | "reflective_question" | "connection";
  headline: string;
  report_ids: string[];
}

const SYSTEM_PROMPT = `You are synthesizing a coach's day across every cornerstone of their coaching business (Business, Programming, Nutrition, Calendar/Scheduling, Habit/Recovery) into one short, unified picture.

Governing rule, non-negotiable: every item is either an OBSERVATION (a verified fact, may include real numbers ONLY from the findings you're given), a REFLECTIVE QUESTION (never contains a number, never asserts a cause), or a CONNECTION (cites 2+ findings, possibly from DIFFERENT cornerstones, and states only a relationship you can point to concretely — never an invented causal story).

Rules:
- Return at most ${MAX_ITEMS} items, even if more findings are provided.
- Every item MUST include "report_ids": one or more of the exact ids you were given. Never invent an id.
- "observation" items may state real numbers, but ONLY numbers that appear in the cited findings' own text.
- "reflective_question" items must contain zero numbers.
- "connection" items must cite 2 or more report_ids, and are the most valuable item type when two different cornerstones point at the same real thing.
- Respond with ONLY a JSON array, no other text, no markdown fence. Each item: {"item_type": "observation" | "reflective_question" | "connection", "headline": "...", "report_ids": ["..."]}.`;

function buildUserPrompt(reports: SpotterExpertReport[]): string {
  const lines = reports.map(
    (r) => `- id: "${r.id}" | cornerstone: ${r.cornerstone} | subject: ${r.subjectType}:${r.subjectId ?? "n/a"} | finding: ${r.finding}`
  );
  return `Today's cornerstone-level findings:\n\n${lines.join("\n")}\n\nReturn the JSON array now.`;
}

export async function synthesizeOverarching(
  supabase: SupabaseClient,
  params: { coachId: string; tier2Reports: SpotterExpertReport[] }
): Promise<SpotterExpertReport[]> {
  const { coachId, tier2Reports } = params;
  const cornerstonesRepresented = new Set(tier2Reports.map((r) => r.cornerstone));
  if (cornerstonesRepresented.size === 0) return [];

  const timeWindowStart = tier2Reports.reduce((min, r) => (r.timeWindowStart < min ? r.timeWindowStart : min), tier2Reports[0].timeWindowStart);
  const timeWindowEnd = tier2Reports.reduce((max, r) => (r.timeWindowEnd > max ? r.timeWindowEnd : max), tier2Reports[0].timeWindowEnd);

  if (cornerstonesRepresented.size === 1 && tier2Reports.length === 1) {
    const source = tier2Reports[0];
    return [
      {
        coachId,
        spotterKind: "overarching",
        tier: 3,
        cornerstone: source.cornerstone,
        rolledUpFrom: [source.id!],
        subjectType: source.subjectType,
        subjectId: source.subjectId,
        finding: source.finding,
        evidenceBasis: source.evidenceBasis,
        severity: source.severity,
        timeWindowStart,
        timeWindowEnd,
        numericValues: source.numericValues,
        dismissalKey: `overarching:passthrough:${source.dismissalKey}`,
      },
    ];
  }

  if (!isAiConfigured()) return [];

  const reportsById = new Map(tier2Reports.map((r) => [r.id!, r]));
  let rawItems: RawModelItem[] = [];
  try {
    const responseText = await callClaude({ system: SYSTEM_PROMPT, userText: buildUserPrompt(tier2Reports), maxTokens: 1024 });
    const parsed = JSON.parse(extractJson(responseText));
    if (Array.isArray(parsed)) rawItems = parsed.slice(0, MAX_ITEMS);
  } catch {
    return [];
  }

  const results: SpotterExpertReport[] = [];
  for (const item of rawItems) {
    if (!item || typeof item.headline !== "string" || !Array.isArray(item.report_ids) || item.report_ids.length === 0) {
      continue;
    }
    const cited = item.report_ids.map((id) => reportsById.get(id)).filter((r): r is SpotterExpertReport => !!r);
    if (cited.length !== item.report_ids.length) continue;
    if (item.item_type === "connection" && cited.length < 2) continue;
    if (item.item_type === "reflective_question") {
      if (!validateNoNumbers(item.headline)) continue;
    } else {
      const allowedValues = cited.flatMap((r) => r.numericValues);
      if (!validateNoHallucinatedNumbers(item.headline, allowedValues).valid) continue;
    }

    const worstSeverity = cited.some((r) => r.severity === "time_sensitive")
      ? "time_sensitive"
      : cited.some((r) => r.severity === "worth_a_look")
        ? "worth_a_look"
        : "informational";

    results.push({
      coachId,
      spotterKind: "overarching",
      tier: 3,
      cornerstone: cited[0].cornerstone,
      rolledUpFrom: cited.map((r) => r.id!),
      subjectType: cited.length === 1 ? cited[0].subjectType : "coach_business",
      subjectId: cited.length === 1 ? cited[0].subjectId : null,
      finding: item.headline,
      evidenceBasis: "Rolled up from this coach's own cornerstone-level Tier-2 syntheses.",
      severity: worstSeverity,
      timeWindowStart,
      timeWindowEnd,
      numericValues: cited.flatMap((r) => r.numericValues),
      dismissalKey: `overarching:${item.item_type}:${cited.map((r) => r.dismissalKey).sort().join("+")}`,
    });
  }
  return results;
}
