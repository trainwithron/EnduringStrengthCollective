// Phase 3 of the gamified-logging thread (custom_shape_theming_idea.md)
// — real plate math for barbell lifts. Given a total logged weight,
// works backward to the actual plate combination sitting on the bar:
// standard denominations (45/35/25/10/5/2.5 lb per side) loaded onto a
// standard 45 lb bar, largest plate first (how a bar is actually
// loaded in a real gym).

export const STANDARD_BAR_WEIGHT_LBS = 45;
const STANDARD_PLATES_LBS = [45, 35, 25, 10, 5, 2.5];

export interface PlateBreakdown {
  barWeight: number;
  totalWeight: number;
  // One plate per side, largest first — e.g. [45, 10] means one 45 and
  // one 10 per side (bar + 45 + 45 + 10 + 10 = 220).
  perSide: number[];
  // False when the remaining weight can't be built exactly from the
  // standard denominations (e.g. below bar weight, or an odd fraction
  // like 2.3 lbs of plate) — caller should show a plain number instead.
  exact: boolean;
}

// Runs on every logged weight (cheap, genuinely informative even for an
// odd number) — the caller decides separately whether a given result is
// "milestone-worthy" via isPlateMathMilestone below.
export function computePlateBreakdown(
  totalWeight: number,
  barWeight: number = STANDARD_BAR_WEIGHT_LBS
): PlateBreakdown {
  if (totalWeight < barWeight) {
    return { barWeight, totalWeight, perSide: [], exact: false };
  }
  let remainingPerSide = (totalWeight - barWeight) / 2;
  const perSide: number[] = [];
  for (const plate of STANDARD_PLATES_LBS) {
    while (remainingPerSide >= plate - 1e-9) {
      perSide.push(plate);
      remainingPerSide -= plate;
    }
  }
  const exact = Math.abs(remainingPerSide) < 1e-9;
  return { barWeight, totalWeight, perSide, exact };
}

// The classic bar-plus-round-plates benchmark weights every lifter
// recognizes on sight — reserved for the big celebratory "pop" treatment,
// distinct from the plain-but-informative breakdown shown for any other
// number.
const MILESTONE_WEIGHTS = new Set([135, 225, 315, 405, 495]);

export function isPlateMathMilestone(totalWeight: number): boolean {
  return MILESTONE_WEIGHTS.has(totalWeight);
}
