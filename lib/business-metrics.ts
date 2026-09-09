// Pure computations behind the Business dashboard — everything here is
// derived from real activity already in the database (roster, credits,
// logged workouts, manually-entered rates). No Stripe/billing data exists
// yet, so "MRR" is explicitly an estimate built from coach-entered rates,
// not a verified payment figure.

export interface RatedClient {
  monthlyRate: number | null;
}

export function computeEstimatedMRR(clients: RatedClient[]): number {
  return clients.reduce((sum, c) => sum + (c.monthlyRate ?? 0), 0);
}

export interface EngagementClient {
  lastActiveDateKey: string | null; // "YYYY-MM-DD", or null if never logged
}

export interface EngagementSummary {
  activeCount: number;
  totalCount: number;
  pct: number; // 0-100, rounded
}

// "Active" = logged at least one workout within `windowDays` of `asOfDateKey`.
export function computeEngagement(
  clients: EngagementClient[],
  asOfDateKey: string,
  windowDays: number
): EngagementSummary {
  const asOf = new Date(`${asOfDateKey}T00:00:00`);
  const activeCount = clients.filter((c) => {
    if (!c.lastActiveDateKey) return false;
    const last = new Date(`${c.lastActiveDateKey}T00:00:00`);
    const diffDays = Math.round((asOf.getTime() - last.getTime()) / 86400000);
    return diffDays >= 0 && diffDays <= windowDays;
  }).length;
  const totalCount = clients.length;
  return {
    activeCount,
    totalCount,
    pct: totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0,
  };
}

// Real, Stripe-sourced figures — additive to the estimated functions
// above, not a replacement. A coach with no packages set up yet still
// sees the manual-rate estimate; these take over once real purchases/
// subscriptions exist (see app/groups/[groupId]/business/page.tsx).

export interface RealIncomeEvent {
  amountCents: number;
  createdAtDateKey: string; // "YYYY-MM-DD"
}

export function computeRealIncomeThisMonth(events: RealIncomeEvent[], monthKey: string): number {
  // monthKey is "YYYY-MM" — a plain prefix match on the date key.
  const cents = events
    .filter((e) => e.createdAtDateKey.startsWith(monthKey))
    .reduce((sum, e) => sum + e.amountCents, 0);
  return cents / 100;
}

export interface ActiveSubscription {
  priceCents: number | null;
  status: "active" | "past_due" | "canceled" | "incomplete";
}

export function computeRealMRR(subs: ActiveSubscription[]): number {
  const cents = subs
    .filter((s) => s.status === "active")
    .reduce((sum, s) => sum + (s.priceCents ?? 0), 0);
  return cents / 100;
}

export interface PayingClient {
  athleteId: string;
  hasActivePurchaseOrSub: boolean;
}

export function computeActivePayingClients(clients: PayingClient[]): number {
  const uniqueIds = new Set(clients.filter((c) => c.hasActivePurchaseOrSub).map((c) => c.athleteId));
  return uniqueIds.size;
}

export interface GrowthBucket {
  monthLabel: string; // "Jan 2026"
  count: number;
}

// New clients per month for the `monthsBack` months ending on (and
// including) the month containing `asOfDateKey`.
export function computeMonthlyGrowth(
  joinedDateKeys: string[],
  asOfDateKey: string,
  monthsBack: number
): GrowthBucket[] {
  const asOf = new Date(`${asOfDateKey}T00:00:00`);
  const buckets: GrowthBucket[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const bucketDate = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
    const label = bucketDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const count = joinedDateKeys.filter((key) => {
      const d = new Date(`${key}T00:00:00`);
      return d.getFullYear() === bucketDate.getFullYear() && d.getMonth() === bucketDate.getMonth();
    }).length;
    buckets.push({ monthLabel: label, count });
  }
  return buckets;
}
