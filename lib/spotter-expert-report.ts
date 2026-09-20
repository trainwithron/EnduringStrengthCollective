// 3-layer Spotter framework
// (two_layer_spotter_framework_architecture_research_sept19.md) — the
// one shared, recursively-nestable report shape used identically at
// every tier. A Tier-2 cornerstone report is structurally the same
// object as a Tier-1 report, just with `spotterKind` set to the
// cornerstone's own name and `rolledUpFrom` populated, so Tier 3 (and a
// human) can always trace a claim back to its real source.

export type Cornerstone = "business" | "programming" | "nutrition" | "calendar" | "habit_recovery";
export type ReportTier = 1 | 2 | 3;
export type ReportSeverity = "informational" | "worth_a_look" | "time_sensitive";
export type ReportSubjectType = "athlete" | "program" | "coach_business";

export interface SpotterExpertReport {
  id?: string;
  coachId: string;
  spotterKind: string;
  tier: ReportTier;
  cornerstone: Cornerstone;
  rolledUpFrom: string[] | null;
  subjectType: ReportSubjectType;
  subjectId: string | null;
  finding: string;
  evidenceBasis: string;
  severity: ReportSeverity;
  timeWindowStart: string;
  timeWindowEnd: string;
  numericValues: number[];
  dismissalKey: string;
}

// Part 2 of the architecture doc's Evidence Gate rule #2 — every
// threshold needs a real, cited authority. These strings are that
// citation, reused verbatim from each Spotter's own already-written
// evidence basis rather than invented fresh here.
export const CORNERSTONE_EVIDENCE_BASIS: Record<Cornerstone, string> = {
  business: "Coach-configured business thresholds (MRR trend, credit balance, waiver compliance, support tickets, lead pipeline).",
  programming: "Programming Spotter's own evidenced checks (volume concentration, redundancy, flat-repeat, missing-pattern-coverage, biomech-redundancy).",
  nutrition: "Nutrition Spotter's own evidenced checks (stale plan, macro mismatch, restricted-ingredient slip, protein too low, injured active deficit).",
  calendar: "Calendar Spotter's dropout-prediction grounding (Sobreiro et al. 2021) plus the org-dispatch and Phase 2 scheduling checks.",
  habit_recovery: "Session Pattern Spotter's session-RPE load-monitoring grounding, plus low-readiness/missed-habits/quiet-client adherence signals.",
};

// The real re-homing map from the architecture doc's own Tier-2 section
// — every existing Tier-1 checkKind/signal kind mapped to its
// cornerstone. `quiet_client` is explicitly flagged in the research as
// the one genuine judgment call (placed under Habit/Recovery as the
// most foundational engagement signal) — kept here, not silently
// resolved as obviously correct.
const CORNERSTONE_BY_SPOTTER_KIND: Record<string, Cornerstone> = {
  // Programming Spotter's 5 checks
  volume_concentration: "programming",
  redundancy: "programming",
  flat_repeat: "programming",
  missing_pattern: "programming",
  biomech_redundancy: "programming",
  // Nutrition Spotter's 5 checks (kinds per lib/nutrition-spotter.ts's own naming)
  stale_plan: "nutrition",
  macro_mismatch: "nutrition",
  restricted_ingredient_slip: "nutrition",
  protein_too_low: "nutrition",
  injured_active_deficit: "nutrition",
  goal_reversal: "nutrition",
  // Calendar Spotter (Phase 1) + Phase 2
  gap: "calendar",
  flaky: "calendar",
  recovery: "calendar",
  recurring_gap: "calendar",
  uneven_load: "calendar",
  duration_mismatch: "calendar",
  // Session Pattern Spotter's 4 signals + existing flat CI signals
  rpe_creep: "habit_recovery",
  rest_time_creep: "habit_recovery",
  struggle_point: "habit_recovery",
  weekday_rushing: "habit_recovery",
  low_readiness: "habit_recovery",
  hrv_suppression: "habit_recovery",
  missed_habits: "habit_recovery",
  quiet_client: "habit_recovery", // the one flagged, arguable placement — see comment above
  // The real SignalKind values from lib/coach-briefing-gather.ts split
  // matched_load_trend into fatigue/gain variants — the research's own
  // note that this is a programming/progression concern, not a
  // habit/recovery one, applies to both.
  matched_load_trend_fatigue: "programming",
  matched_load_trend_gain: "programming",
};

export function cornerstoneForSpotterKind(spotterKind: string): Cornerstone | null {
  return CORNERSTONE_BY_SPOTTER_KIND[spotterKind] ?? null;
}
