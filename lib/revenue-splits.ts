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
