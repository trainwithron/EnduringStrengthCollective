// 3-layer Spotter framework, Tier-2 cornerstone synthesis
// (two_layer_spotter_framework_architecture_research_sept19.md, Part 2).
// Reuses the exact real, proven mechanism from
// app/api/cron/coach-briefing/route.ts (strict system prompt, numeral
// guard, citation-integrity check) rather than inventing a new one —
// just pointed at one cornerstone's own Tier-1 pool instead of the
// whole roster.
//
// The real cost-aware rule from Part 2: 0 inputs -> nothing; exactly 1
// input -> pass through unchanged, re-tagged at tier 2, zero AI cost;
// 2+ inputs -> one real, bounded AI call.
import type { SupabaseClient } from "@supabase/supabase-js";
import { callClaude, extractJson, isAiConfigured } from "./anthropic-client";
import { validateNoHallucinatedNumbers, validateNoNumbers } from "./coach-briefing-numeral-guard";
import { CORNERSTONE_EVIDENCE_BASIS, type Cornerstone, type SpotterExpertReport } from "./spotter-expert-report";

const MAX_ITEMS = 3;

interface RawModelItem {
  item_type: "observation" | "reflective_question" | "connection";
  headline: string;
  report_ids: string[];
}

function buildSystemPrompt(cornerstoneLabel: string): string {
  return `You are synthesizing real, already-computed findings about a coach's ${cornerstoneLabel} into a short summary of what they mean for ${cornerstoneLabel} specifically.

Governing rule, non-negotiable: every item is either an OBSERVATION (a verified fact, may include real numbers ONLY from the findings you're given), a REFLECTIVE QUESTION (never contains a number, never asserts a cause), or a CONNECTION (cites 2+ findings and states only a relationship you can point to concretely — e.g. the same subject, an overlapping time window — never an invented causal story).

Rules:
- Return at most ${MAX_ITEMS} items, even if more findings are provided.
- Every item MUST include "report_ids": one or more of the exact ids you were given. Never invent an id.
- "observation" items may state real numbers, but ONLY numbers that appear in the cited findings' own text.
- "reflective_question" items must contain zero numbers.
- "connection" items must cite 2 or more report_ids.
- Respond with ONLY a JSON array, no other text, no markdown fence. Each item: {"item_type": "observation" | "reflective_question" | "connection", "headline": "...", "report_ids": ["..."]}.`;
}

function buildUserPrompt(reports: SpotterExpertReport[]): string {
  const lines = reports.map((r) => `- id: "${r.id}" | subject: ${r.subjectType}:${r.subjectId ?? "n/a"} | finding: ${r.finding}`);
  return `Real findings for this cornerstone today:\n\n${lines.join("\n")}\n\nReturn the JSON array now.`;
}

export async function synthesizeCornerstone(
  supabase: SupabaseClient,
  params: { coachId: string; cornerstone: Cornerstone; tier1Reports: SpotterExpertReport[] }
): Promise<SpotterExpertReport[]> {
  const { coachId, cornerstone, tier1Reports } = params;
  if (tier1Reports.length === 0) return [];

  const timeWindowStart = tier1Reports.reduce((min, r) => (r.timeWindowStart < min ? r.timeWindowStart : min), tier1Reports[0].timeWindowStart);
  const timeWindowEnd = tier1Reports.reduce((max, r) => (r.timeWindowEnd > max ? r.timeWindowEnd : max), tier1Reports[0].timeWindowEnd);

  // Exactly one real input — pass through unchanged, zero AI cost, per
  // Part 2's own explicit cost rule.
  if (tier1Reports.length === 1) {
    const source = tier1Reports[0];
    return [
      {
        coachId,
        spotterKind: cornerstone,
        tier: 2,
        cornerstone,
        rolledUpFrom: [source.id!],
        subjectType: source.subjectType,
        subjectId: source.subjectId,
        finding: source.finding,
        evidenceBasis: source.evidenceBasis,
        severity: source.severity,
        timeWindowStart,
        timeWindowEnd,
        numericValues: source.numericValues,
        dismissalKey: `cornerstone:${cornerstone}:passthrough:${source.dismissalKey}`,
      },
    ];
  }

  if (!isAiConfigured()) return [];

  const reportsById = new Map(tier1Reports.map((r) => [r.id!, r]));
  let rawItems: RawModelItem[] = [];
  try {
    const responseText = await callClaude({
      system: buildSystemPrompt(cornerstone.replace("_", "/")),
      userText: buildUserPrompt(tier1Reports),
      maxTokens: 1024,
    });
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
    if (cited.length !== item.report_ids.length) continue; // cited an id it was never given

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
      spotterKind: cornerstone,
      tier: 2,
      cornerstone,
      rolledUpFrom: cited.map((r) => r.id!),
      subjectType: cited.length === 1 ? cited[0].subjectType : "coach_business",
      subjectId: cited.length === 1 ? cited[0].subjectId : null,
      finding: item.headline,
      evidenceBasis: CORNERSTONE_EVIDENCE_BASIS[cornerstone],
      severity: worstSeverity,
      timeWindowStart,
      timeWindowEnd,
      numericValues: cited.flatMap((r) => r.numericValues),
      dismissalKey: `cornerstone:${cornerstone}:${item.item_type}:${cited.map((r) => r.dismissalKey).sort().join("+")}`,
    });
  }
  return results;
}
