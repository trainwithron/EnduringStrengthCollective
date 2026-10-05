// The real gather-and-rank layer powering the public marketplace browse
// UI — assembles a full CoachRankingInput per real coach on the
// platform and calls marketplace-coach-ranking.ts's pure scoring.
// Deliberately no "Newly Verified" cold-start boost wiring yet — that
// trust-tier mechanism isn't built anywhere in this codebase today
// (checked directly before writing this), so every coach with zero
// real outcome cases correctly falls through to the engine's own
// "drop the outcome factor, re-normalize distance+goal-fit" path,
// which is the honest behavior given no real boost mechanism exists —
// not a gap in this file.
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapGoalTypeToTrainingIntents } from "./trainer-dispatch";
import type { TrainingIntent } from "./training-intent";
import {
  computeCoachRankingScore,
  DEFAULT_RANKING_WEIGHTS,
  type GoalType,
  type RankingWeights,
} from "./marketplace-coach-ranking";
import { gatherOutcomeCasesForCoach } from "./marketplace-outcome-gather";
import { computeZipDistanceMiles } from "./zip-distance";

export interface RankedCoachResult {
  coachId: string;
  coachName: string;
  orgName: string;
  orgZipCode: string | null;
  distanceMiles: number | null;
  score: number;
  distanceScore: number;
  goalFitScore: number;
  outcomeScore: number | null;
  realOutcomeCaseCount: number;
}

export async function findRankedCoaches(
  supabase: SupabaseClient,
  options: { prospectZip: string | null; goalType: GoalType; weights?: RankingWeights }
): Promise<RankedCoachResult[]> {
  const { prospectZip, goalType } = options;

  // Every real coach on the platform, via organization_memberships —
  // matches this codebase's own established definition of "a coach"
  // (owner/admin/coach roles all coach real clients in this app; a
  // pure billing-only role doesn't exist here). Joins straight to the
  // org for its real zip_code and to profiles for a display name.
  const { data: memberRows } = await supabase
    .from("organization_memberships")
    .select("profile_id, organization_id, profiles ( full_name ), organizations ( name, zip_code, listed_in_marketplace )")
    .in("role", ["owner", "admin", "coach"]);
  if (!memberRows || memberRows.length === 0) return [];

  const weights = options.weights ?? DEFAULT_RANKING_WEIGHTS;
  const relevantIntents = new Set<TrainingIntent>(mapGoalTypeToTrainingIntents(goalType));

  const results: RankedCoachResult[] = [];

  // Cast via `any` rather than a precise row type — the Supabase JS
  // client infers joined relations as arrays here without generated
  // types, the same real shape every other cross-table select in this
  // codebase already works around this exact way (e.g.
  // components/coach/desktop/group-switcher.tsx's own `(row as any).groups`).
  for (const rawRow of memberRows) {
    const row = rawRow as any;
    const coachId: string = row.profile_id;
    const orgZip: string | null = row.organizations?.zip_code ?? null;
    // Opt-in: an organization is listed only after its owner or admin turns it on (migration 0256).
    if (!row.organizations?.listed_in_marketplace) continue;

    // Real per-coach program library — same "created_by" scoping
    // lib/trainer-dispatch-gather.ts's own findAndRankAvailableTrainers
    // already uses, for a consistent, already-proven definition of
    // "this coach's own programs" across both features.
    const { data: programRows } = await supabase
      .from("programs")
      .select("training_intent")
      .eq("created_by", coachId)
      .not("training_intent", "is", null);
    const totalProgramCount = (programRows ?? []).length;
    if (totalProgramCount === 0) continue; // no real program library yet — nothing to rank fairly

    const intentCounts: Partial<Record<TrainingIntent, number>> = {};
    for (const p of (programRows ?? []) as { training_intent: TrainingIntent }[]) {
      intentCounts[p.training_intent] = (intentCounts[p.training_intent] ?? 0) + 1;
    }
    // A coach with real programs, but none in this goal's relevant
    // intents at all, still ranks (goal-fit score of 0 is a real,
    // honest signal) — not excluded outright, since distance/outcome
    // may still make them worth showing.
    void relevantIntents;

    const distanceMiles = computeZipDistanceMiles(prospectZip, orgZip);
    const outcomeCases = await gatherOutcomeCasesForCoach(supabase, coachId, goalType);

    const result = computeCoachRankingScore({
      distanceMiles: distanceMiles ?? Number.POSITIVE_INFINITY,
      intentCounts,
      totalProgramCount,
      goalType,
      outcomeCases,
      weights,
    });

    results.push({
      coachId,
      coachName: row.profiles?.full_name ?? "Coach",
      orgName: row.organizations?.name ?? "",
      orgZipCode: orgZip,
      distanceMiles,
      score: result.score,
      distanceScore: result.distanceScore,
      goalFitScore: result.goalFitScore,
      outcomeScore: result.outcomeScore,
      realOutcomeCaseCount: outcomeCases.length,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}
