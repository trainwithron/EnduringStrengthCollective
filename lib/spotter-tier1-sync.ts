// 3-layer Spotter framework, Tier-1 sync
// (two_layer_spotter_framework_architecture_research_sept19.md). Pulls
// real findings from the Spotters that already have a clean, callable
// gather function and writes them into the shared spotter_expert_reports
// table as real Tier-1 rows.
//
// Honest, deliberate scope limit, matching the architecture doc's own
// caveat that migrating every existing page-Spotter is "real, non-
// trivial work... worth its own scoping/sequencing pass, not bundled
// silently": this syncs Programming Spotter, Calendar Spotter (Phase 1
// + 2), and the 7 existing flat Collective Intelligence signals — which
// together cover 3 of the 5 cornerstones (Programming, Calendar,
// Habit/Recovery) with real, live data. Nutrition Spotter's detection
// logic is currently inline in app/groups/[groupId]/nutrition/page.tsx
// (never extracted into a reusable per-roster gather function), and the
// Business cornerstone's own Tier-1 inputs are still the unstructured
// /api/coach/spot-glance precursor the research itself named, not a
// real gather function either — both are flagged as a real, separate
// follow-up, not silently treated as covered.
import type { SupabaseClient } from "@supabase/supabase-js";
import { gatherProgrammingSpotterFlags } from "./programming-spotter-gather";
import { gatherCalendarSpotterFindings } from "./calendar-spotter-gather";
import { gatherSchedulingSpotterFlags } from "./calendar-spotter-phase2-gather";
import { gatherCandidateSignals } from "./coach-briefing-gather";
import { cornerstoneForSpotterKind, CORNERSTONE_EVIDENCE_BASIS, type SpotterExpertReport } from "./spotter-expert-report";

function todayWindow(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: now.toISOString() };
}

export async function syncTier1ExpertReports(
  supabase: SupabaseClient,
  params: { coachId: string; groupIds: string[]; organizationId: string | null }
): Promise<SpotterExpertReport[]> {
  const { coachId, groupIds, organizationId } = params;
  const { start, end } = todayWindow();
  const reports: SpotterExpertReport[] = [];

  function pushReport(input: {
    spotterKind: string;
    subjectType: SpotterExpertReport["subjectType"];
    subjectId: string | null;
    finding: string;
    numericValues: number[];
    dismissalKey: string;
    severity?: SpotterExpertReport["severity"];
  }) {
    const cornerstone = cornerstoneForSpotterKind(input.spotterKind);
    if (!cornerstone) return; // an unrecognized kind never silently gets a wrong cornerstone
    reports.push({
      coachId,
      spotterKind: input.spotterKind,
      tier: 1,
      cornerstone,
      rolledUpFrom: null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      finding: input.finding,
      evidenceBasis: CORNERSTONE_EVIDENCE_BASIS[cornerstone],
      severity: input.severity ?? "worth_a_look",
      timeWindowStart: start,
      timeWindowEnd: end,
      numericValues: input.numericValues,
      dismissalKey: input.dismissalKey,
    });
  }

  // --- Programming Spotter, every real active program this coach runs ---
  const { data: programRows } = await supabase
    .from("programs")
    .select("id, name, group_id")
    .in("group_id", groupIds)
    .eq("is_active", true);
  for (const program of programRows ?? []) {
    const flags = await gatherProgrammingSpotterFlags(supabase, {
      programId: program.id,
      programName: program.name,
      coachId,
    });
    for (const flag of flags) {
      pushReport({
        spotterKind: flag.checkKind,
        subjectType: "program",
        subjectId: program.id,
        finding: flag.headline,
        numericValues: [],
        dismissalKey: `programming:${program.id}:${flag.checkKind}:${flag.patternKey}`,
      });
    }
  }

  // --- Calendar Spotter Phase 1, per real group ---
  for (const groupId of groupIds) {
    const findings = await gatherCalendarSpotterFindings(supabase, { groupId });
    for (const f of findings) {
      pushReport({
        spotterKind: f.kind,
        subjectType: "athlete",
        subjectId: f.athleteId,
        finding: f.message,
        numericValues: [],
        dismissalKey: `calendar:${groupId}:${f.kind}:${f.athleteId}`,
        severity: f.kind === "gap" ? "time_sensitive" : "worth_a_look",
      });
    }
  }

  // --- Calendar Spotter Phase 2, coach-wide ---
  const schedulingFlags = await gatherSchedulingSpotterFlags(supabase, { coachId, organizationId });
  for (const flag of schedulingFlags) {
    pushReport({
      spotterKind: flag.checkKind,
      subjectType: "coach_business",
      subjectId: null,
      finding: flag.headline,
      numericValues: [],
      dismissalKey: `scheduling:${flag.checkKind}:${flag.patternKey}`,
    });
  }

  // --- The 7 existing flat Collective Intelligence signals ---
  const candidates = await gatherCandidateSignals(supabase, { coachId, groupIds });
  for (const c of candidates) {
    pushReport({
      spotterKind: c.kind,
      subjectType: "athlete",
      subjectId: c.athleteId,
      finding: c.description,
      numericValues: c.numericValues,
      dismissalKey: `briefing:${c.kind}:${c.athleteId}`,
      severity: c.kind === "hrv_suppression" || c.kind === "low_readiness" ? "time_sensitive" : "worth_a_look",
    });
  }

  if (reports.length === 0) return [];

  const { data: inserted } = await supabase
    .from("spotter_expert_reports")
    .upsert(
      reports.map((r) => ({
        coach_id: r.coachId,
        spotter_kind: r.spotterKind,
        tier: r.tier,
        cornerstone: r.cornerstone,
        rolled_up_from: r.rolledUpFrom,
        subject_type: r.subjectType,
        subject_id: r.subjectId,
        finding: r.finding,
        evidence_basis: r.evidenceBasis,
        severity: r.severity,
        time_window_start: r.timeWindowStart,
        time_window_end: r.timeWindowEnd,
        numeric_values: r.numericValues,
        dismissal_key: r.dismissalKey,
      })),
      { onConflict: "coach_id,dismissal_key,tier,report_date" }
    )
    .select("id, dismissal_key");

  const idByKey = new Map((inserted ?? []).map((row) => [row.dismissal_key, row.id]));
  return reports.map((r) => ({ ...r, id: idByKey.get(r.dismissalKey) }));
}
