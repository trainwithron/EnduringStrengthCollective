// Transformation Cards (transformation_card_full_design.md) — the
// escalating weight-loss milestone thresholds. Detection is fully
// automated (the system notices a real crossing); actually generating
// and sharing a card stays the athlete's own choice every time — this
// module only decides WHICH threshold(s) just became true, never
// whether to publish anything.

export const WEIGHT_LOSS_THRESHOLDS_LBS = [5, 10, 20, 50, 75, 100, 150, 200] as const;

// Every threshold at or below the current total loss that hasn't been
// recorded yet — not just the highest one. A gap in logging (or a
// sudden real jump) can cross several tiers in one check-in; all of
// them get marked "seen" so none silently re-fires later, even though
// only the highest is worth actually prompting about.
export function computeNewlyCrossedThresholds(
  totalLossLbs: number,
  alreadySeenThresholds: ReadonlySet<number>
): number[] {
  if (totalLossLbs <= 0) return [];
  return WEIGHT_LOSS_THRESHOLDS_LBS.filter(
    (t) => totalLossLbs >= t && !alreadySeenThresholds.has(t)
  );
}

export function computeHighestNewThreshold(
  totalLossLbs: number,
  alreadySeenThresholds: ReadonlySet<number>
): number | null {
  const newly = computeNewlyCrossedThresholds(totalLossLbs, alreadySeenThresholds);
  return newly.length > 0 ? Math.max(...newly) : null;
}
