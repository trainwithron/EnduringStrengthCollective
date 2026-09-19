// Revenue-split math — built internally per the "everything except
// Stripe" pattern (see Business dashboard, Challenges, Referral
// Directory): a real, testable computation of who gets what, ready to
// drive actual Stripe Connect transfers once that's connected. Nothing
// here moves real money.

export interface CoachShare {
  profileId: string;
  fullName: string;
  role: "owner" | "admin" | "coach";
  revenueSharePct: number;
}

export interface RevenueSplitResult {
  totalRevenueCents: number;
  platformFeeCents: number;
  remainderCents: number;
  coachShares: { profileId: string; fullName: string; amountCents: number; pct: number }[];
  unallocatedCents: number; // remainder not covered by any coach's share
}

export function computeRevenueSplit(
  totalRevenueCents: number,
  platformFeePct: number,
  coaches: CoachShare[]
): RevenueSplitResult {
  const platformFeeCents = Math.round(totalRevenueCents * (platformFeePct / 100));
  const remainderCents = totalRevenueCents - platformFeeCents;

  const coachShares = coaches.map((c) => ({
    profileId: c.profileId,
    fullName: c.fullName,
    pct: c.revenueSharePct,
    amountCents: Math.round(remainderCents * (c.revenueSharePct / 100)),
  }));

  const allocated = coachShares.reduce((sum, c) => sum + c.amountCents, 0);

  return {
    totalRevenueCents,
    platformFeeCents,
    remainderCents,
    coachShares,
    unallocatedCents: remainderCents - allocated,
  };
}

export function formatSplitCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// platform_flat_fee_revenue_split_scoping_sept19.md — a flat
// platform-level take, taken off the gross charge FIRST, before
// computeRevenueSplit (unchanged above) runs on whatever remains. Real
// Stripe processing fee (from balance_transaction.fee, never
// estimated) plus a flat $0.10 to Ron. Confirmed with Ron directly: no
// percentage, no business-model shift — just cover the real card
// processing cost and a dime.
export const PLATFORM_FLAT_FEE_CENTS = 10;

export interface PlatformDeduction {
  grossAmountCents: number;
  stripeProcessingFeeCents: number;
  platformFlatFeeCents: number;
  totalDeductionCents: number;
  netAmountCents: number;
}

export function computePlatformDeduction(
  grossAmountCents: number,
  stripeProcessingFeeCents: number
): PlatformDeduction {
  const totalDeductionCents = stripeProcessingFeeCents + PLATFORM_FLAT_FEE_CENTS;
  // A near-zero charge (or a stripeProcessingFeeCents lookup that came
  // back larger than the charge itself, which shouldn't happen but
  // isn't worth crashing over) never produces a negative net — clamped
  // at 0, same defensive floor computeRevenueSplit's own callers rely on.
  const netAmountCents = Math.max(0, grossAmountCents - totalDeductionCents);
  return {
    grossAmountCents,
    stripeProcessingFeeCents,
    platformFlatFeeCents: PLATFORM_FLAT_FEE_CENTS,
    totalDeductionCents,
    netAmountCents,
  };
}
