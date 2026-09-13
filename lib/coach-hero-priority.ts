// "Right now" hero selection (coach_dashboard_redesign_scoping.md) — one
// computed, most-urgent item across the coach's whole book of business,
// written as a real sentence with one clear CTA, not a list to scan.
//
// Full resolved priority order, highest to lowest:
//   1. injury/pain flag        <- DEFERRED. Needs a new low-friction
//                                 exercise-notes field plus an LLM
//                                 (Claude Haiku) classifier and a Privacy
//                                 Policy disclosure update — a materially
//                                 separate vertical slice, not built yet.
//                                 Left out of this ranking entirely for
//                                 now rather than faked.
//   2. low wellness readiness
//   3. missed workout / inactivity (quiet-client tier)
//   4. missed habits / nutrition logging
// Coach-responsiveness (unanswered threads) and business/account issues
// (out of credits) are deliberately NOT part of this ranking — they stay
// their own separate flags elsewhere on the page.

export type HeroFlag =
  | { kind: "low_readiness"; athleteId: string; athleteName: string; groupId: string; groupName: string; readiness: number }
  | { kind: "quiet_client"; athleteId: string; athleteName: string; groupId: string; groupName: string; tier: "mild" | "strong" }
  | { kind: "missed_habits"; athleteId: string; athleteName: string; groupId: string; groupName: string; missedCount: number };

const KIND_RANK: Record<HeroFlag["kind"], number> = {
  low_readiness: 0,
  quiet_client: 1,
  missed_habits: 2,
};

// Within quiet_client, a strong tier outranks a mild one — both still
// slot into the same overall category between readiness and habits.
function subRank(flag: HeroFlag): number {
  if (flag.kind === "quiet_client") return flag.tier === "strong" ? 0 : 1;
  return 0;
}

// Selects the single highest-priority flag. Stable ordering (rank, then
// sub-rank, then first-seen) so the same inputs always pick the same
// flag rather than an arbitrary one among ties.
export function selectHeroFlag(flags: HeroFlag[]): HeroFlag | null {
  if (flags.length === 0) return null;
  return [...flags].sort((a, b) => {
    const rankDiff = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (rankDiff !== 0) return rankDiff;
    return subRank(a) - subRank(b);
  })[0];
}
