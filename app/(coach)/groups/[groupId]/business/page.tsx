import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import Link from "next/link";
import { inOrg, orgIdOfGroup } from "@/lib/org-of-group";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { redirectOneOnOneToAnchor } from "@/lib/coach-wide-redirect";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { loadBusinessScope } from "@/lib/business-scope";
import { countByIds, readByIds } from "@/lib/read-by-ids";
import { pageAll } from "@/lib/page-all";
import { createServerClient } from "@/lib/supabase/server";
import { getViewerDisplayTimezone } from "@/lib/display-timezone-server";
import { dateKeyInZone, monthBoundsInZone } from "@/lib/timezone";
import { headlineMrr } from "@/lib/coach-mrr";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ClientRateEditor } from "@/components/coach/desktop/client-rate-editor";
import { SwappableTerm } from "@/components/coach/swappable-term";
import { StatHeroTile } from "@/components/coach/desktop/stat-hero-tile";
import { PaymentProblemsSection } from "@/components/coach/payment-problems-section";
import { ratesByMembership } from "@/lib/client-rates";
import {
  computeEstimatedMRR,
  computeEngagement,
  computeMonthlyGrowth,
  computeRealIncomeThisMonth,
  computeRealMRR,
  computeRealPausedMRR,
  computeActivePayingClients,
} from "@/lib/business-metrics";

export const metadata = { title: "Business" };

const TIER_LABELS: Record<string, string> = {
  one_on_one: "1-on-1",
  online: "Online",
  group: "Group",
};

export default async function BusinessDashboardPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  await redirectOneOnOneToAnchor(params.groupId, "business");
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (isReadFailure(membershipError)) return <LoadFailedPage />;

  if (membership?.role !== "coach") {
    return (
      <NoAccess>Only coaches can view the business dashboard.</NoAccess>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  // Every group this coach runs IN THIS ORGANIZATION: the business view spans the whole business of the organization that is open, never another organization's clients or income.
  // A coach: their own groups. The owner or an admin of the organization: every group in it (all coaches, all clients).
  const scope = await loadBusinessScope(supabase, user.id, params.groupId);
  const groupIds = scope.groupIds;
  if (scope.failed) return <LoadFailedPage />;

  // Every read below goes in groups of ids and a page at a time (readByIds): with 1,500 clients there are 1,500 groups, past the URL limit of one request and the 1,000-row cap, and either
  // used to drop rows without a word. A read that fails shows "couldn't load", never a smaller business.
  const [members, rates, credits] = await Promise.all([
    readByIds(groupIds, (g) => (from, to) =>
      supabase.from("group_memberships").select("id, group_id, profile_id, joined_at, client_tier, profiles ( full_name )").in("group_id", g).eq("role", "athlete").order("id").range(from, to)
    ),
    // What each client pays is coach-only (client_billing_rates, 0303).
    readByIds(groupIds, (g) => (from, to) => supabase.from("client_billing_rates").select("membership_id, monthly_rate").in("group_id", g).order("membership_id").range(from, to)),
    readByIds(groupIds, (g) => (from, to) => supabase.from("session_credits").select("athlete_id, group_id, balance").in("group_id", g).order("group_id").order("athlete_id").range(from, to)),
  ]);
  if (members.failed || rates.failed || credits.failed) return <LoadFailedPage />;
  const memberRows = members.rows.sort((a, b) => String(b.joined_at).localeCompare(String(a.joined_at)));
  const rateByMembership = ratesByMembership(rates.rows);
  const creditRows = credits.rows;

  const clients = memberRows.map((m) => ({
    membershipId: m.id,
    groupId: m.group_id,
    athleteId: m.profile_id,
    fullName: (m.profiles as any)?.full_name ?? "Unknown",
    joinedAt: m.joined_at as string,
    clientTier: m.client_tier as string | null,
    monthlyRate: rateByMembership.get(m.id as string) ?? null,
  }));

  const uniqueAthleteIds = new Set(clients.map((c) => c.athleteId));

  const totalOutstandingCredits = creditRows.reduce((sum, r) => sum + (r.balance ?? 0), 0);

  // Every day and month on this page is the coach's own (the zone their device is in), not the server's UTC.
  const displayZone = await getViewerDisplayTimezone(supabase, user.id);
  const dateKey = (d: Date): string => dateKeyInZone(displayZone, d);

  // The last workout of each client, worked out by the database (one row per client) instead of reading every workout ever logged.
  const lastActive = await pageAll((from, to) => supabase.rpc("business_last_active", { p_group_ids: groupIds }).range(from, to));
  if (lastActive.failed) return <LoadFailedPage />;
  const lastActiveByAthlete = new Map<string, string>();
  for (const row of lastActive.rows) {
    if (!lastActiveByAthlete.has(row.athlete_id)) {
      lastActiveByAthlete.set(row.athlete_id, dateKey(new Date(row.last_at)));
    }
  }

  const todayKey = dateKey(new Date());
  const { monthKey, startIso: monthStartIso } = monthBoundsInZone(displayZone);

  const { count: bookingsThisMonthCount, failed: bookingsCountFailed } = await countByIds(groupIds, (g) =>
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("group_id", g)
      .eq("status", "confirmed")
      // a coach counts their own sessions; the owner or an admin counts every coach's
      .match(scope.organizationWide ? {} : { coach_id: user.id })
      .gte("start_at", monthStartIso)
  );
  if (bookingsCountFailed) return <LoadFailedPage />;

  const organizationId = await orgIdOfGroup(supabase, params.groupId);
  const { data: referralRows } = await inOrg(supabase.from("referral_partners").select("click_count").eq("coach_id", user.id), organizationId);
  const totalReferralClicks = (referralRows ?? []).reduce((sum, r) => sum + (r.click_count ?? 0), 0);

  const { data: proShopRows } = await inOrg(supabase.from("pro_shop_links").select("click_count").eq("coach_id", user.id), organizationId);
  const totalProShopClicks = (proShopRows ?? []).reduce((sum, r) => sum + (r.click_count ?? 0), 0);

  // Real, Stripe-sourced figures — additive to the manual-rate estimate
  // below, not a replacement. A coach with no packages configured yet
  // simply gets 0 here and keeps seeing the estimate as their only signal.

  // v3_visual_polish_mockup_sept15.md's "Dashboard Empty State & Business
  // Tiles" mockup — a true zero (no packages ever configured) needs to
  // read differently from a real "$0 this period" (packages exist, just
  // no purchases yet). Package existence, not the period's totals, is
  // the real "has billing even been set up" signal.
  const [packages, purchases, subscriptions] = await Promise.all([
    countByIds(groupIds, (g) =>
      supabase
        .from("coach_packages")
        .select("id", { count: "exact", head: true })
        .in("group_id", g)
        .match(scope.organizationWide ? {} : { coach_id: user.id })
    ),
    readByIds(groupIds, (g) => (from, to) => supabase.from("credit_purchases").select("athlete_id, amount_cents, created_at").in("group_id", g).order("id").range(from, to)),
    readByIds(groupIds, (g) => (from, to) => supabase.from("membership_subscriptions").select("athlete_id, price_cents, status").in("group_id", g).order("group_id").order("athlete_id").range(from, to)),
  ]);
  if (packages.failed || purchases.failed || subscriptions.failed) return <LoadFailedPage />;
  const hasBillingSetUp = packages.count > 0;
  const purchaseRows = purchases.rows;
  const subscriptionRows = subscriptions.rows;

  const realIncomeThisMonth = computeRealIncomeThisMonth(
    (purchaseRows ?? []).map((p) => ({
      amountCents: p.amount_cents,
      createdAtDateKey: dateKey(new Date(p.created_at)),
    })),
    monthKey
  );
  const subscriptionsForMRR = (subscriptionRows ?? []).map((s) => ({
    priceCents: s.price_cents,
    status: s.status as "active" | "past_due" | "canceled" | "incomplete" | "paused",
  }));
  const realMRR = computeRealMRR(subscriptionsForMRR);
  // subscription_pause_mechanics_research.md — a paused member's revenue
  // shouldn't just vanish from what a coach sees once it's correctly
  // excluded from MRR above; surfaced as its own line instead.
  const pausedMRR = computeRealPausedMRR(subscriptionsForMRR);

  const athleteIdsWithPurchase = new Set((purchaseRows ?? []).map((p) => p.athlete_id));
  const athleteIdsWithActiveSub = new Set(
    (subscriptionRows ?? []).filter((s) => s.status === "active").map((s) => s.athlete_id)
  );
  const creditBalanceByAthlete = new Map((creditRows ?? []).map((r) => [r.athlete_id, r.balance ?? 0]));
  const payingClientsCount = computeActivePayingClients(
    [...uniqueAthleteIds].map((athleteId) => ({
      athleteId,
      hasActivePurchaseOrSub:
        athleteIdsWithActiveSub.has(athleteId) ||
        (athleteIdsWithPurchase.has(athleteId) && (creditBalanceByAthlete.get(athleteId) ?? 0) > 0),
    }))
  );

  const estimatedMRR = computeEstimatedMRR(clients.map((c) => ({ monthlyRate: c.monthlyRate })));
  const engagement = computeEngagement(
    [...uniqueAthleteIds].map((id) => ({ lastActiveDateKey: lastActiveByAthlete.get(id) ?? null })),
    todayKey,
    14
  );
  const growth = computeMonthlyGrowth(
    clients.map((c) => dateKey(new Date(c.joinedAt))),
    todayKey,
    6
  );
  const maxGrowthCount = Math.max(1, ...growth.map((g) => g.count));

  const newThisMonth = clients.filter((c) => {
    return dateKey(new Date(c.joinedAt)).slice(0, 7) === monthKey;
  }).length;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="business">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Business</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          A snapshot of this organization.{" "}
          {realMRR > 0 || realIncomeThisMonth > 0
            ? "Income and MRR below are real, from your connected packages."
            : "Set up packages to see real income and MRR here — until then, the manual rate estimate below is your only signal."}
        </p>
      </div>

      <PaymentProblemsSection groupIds={groupIds} timezone={displayZone} />

      {/* MRR is the hero: recurring revenue is the actual "is this
          business healthy right now" number — a single month's income
          can spike from a one-time credit purchase, but MRR is the
          number that persists. The other 7 metrics stay real and
          visible, just clearly secondary (smaller, no accent, 4-across
          so the last row doesn't leave an odd single tile stranded). */}
      <div className="mb-4">
        <StatHeroTile
          label={realMRR > 0 ? "MRR" : "Estimated MRR"}
          value={`$${headlineMrr(realMRR, estimatedMRR).value.toLocaleString()}`}
          detail={realMRR > 0 ? "From active subscriptions — the clearest signal of business health" : "From rates set below — set up packages for a real number"}
        />
        {pausedMRR > 0 && (
          <p className="font-body text-xs text-steel mt-2">
            +${pausedMRR.toLocaleString()}/mo paused — not counted above, but not lost either.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {hasBillingSetUp ? (
          <div className="border border-steel/20 rounded-token-lg p-3">
            <p className="font-display text-2xl leading-none">${realIncomeThisMonth.toLocaleString()}</p>
            <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Income this month</p>
          </div>
        ) : (
          <div className="border border-steel/20 rounded-token-lg p-3 opacity-60">
            <p className="font-display text-2xl leading-none text-steel">—</p>
            <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Income this month</p>
            <p className="font-body text-xs text-steel mt-0.5">No billing yet</p>
          </div>
        )}
        <div className="border border-steel/20 rounded-token-lg p-3">
          <p className="font-display text-2xl leading-none">{uniqueAthleteIds.size}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Roster size</p>
          {newThisMonth > 0 && (
            <p className="font-body text-xs text-positive mt-0.5">+{newThisMonth} this month</p>
          )}
        </div>
        {hasBillingSetUp ? (
          <div className="border border-steel/20 rounded-token-lg p-3">
            <p className="font-display text-2xl leading-none">{payingClientsCount}</p>
            <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
              Paying <SwappableTerm termKey="client" form="plural" />
            </p>
          </div>
        ) : (
          <Link
            href={`/groups/${params.groupId}/business/packages`}
            className="rounded-token-lg p-3 bg-surface border border-rust/30 shadow-[0_0_0_1px_rgb(var(--rust)/0.15),0_0_16px_rgb(var(--rust)/0.12)] block"
          >
            <p className="font-display text-2xl leading-none">{payingClientsCount}</p>
            <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
              Paying <SwappableTerm termKey="client" form="plural" />
            </p>
            <p className="font-body text-xs text-rust mt-0.5">Set up packages &rarr;</p>
          </Link>
        )}
        <div className="border border-steel/20 rounded-token-lg p-3">
          <p className="font-display text-2xl leading-none">{totalOutstandingCredits}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
            Outstanding credits
          </p>
        </div>
        <div className="border border-steel/20 rounded-token-lg p-3">
          <p className="font-display text-2xl leading-none">{bookingsThisMonthCount ?? 0}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Sessions this month</p>
        </div>
        <div className="border border-steel/20 rounded-token-lg p-3">
          <p className="font-display text-2xl leading-none">{totalReferralClicks}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Referral clicks</p>
        </div>
        <div className="border border-steel/20 rounded-token-lg p-3">
          <p className="font-display text-2xl leading-none">{totalProShopClicks}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Pro Shop clicks</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="border border-steel/20 rounded-token-lg p-4">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
            <SwappableTerm termKey="client" form="singular" className="capitalize" /> growth (last 6 months)
          </h2>
          <div className="flex items-end gap-3 h-28">
            {growth.map((g) => (
              <div key={g.monthLabel} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="font-body text-xs text-chalk">{g.count}</span>
                <div
                  className="w-full bg-rust"
                  style={{ height: `${Math.max(4, (g.count / maxGrowthCount) * 80)}px` }}
                />
                <span className="font-body text-xs text-steel">{g.monthLabel}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-steel/20 rounded-token-lg p-4">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
            Engagement (last 14 days)
          </h2>
          <p className="font-display text-3xl leading-none">
            {engagement.activeCount}/{engagement.totalCount}
          </p>
          <p className="font-body text-xs text-steel mt-1">
            {engagement.pct}% of clients logged a workout in the last 14 days
          </p>
          <div className="w-full h-2 bg-surface mt-3">
            <div className="h-2 bg-positive" style={{ width: `${engagement.pct}%` }} />
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
          <SwappableTerm termKey="client" form="singular" className="capitalize" /> rates
        </h2>
        <p className="font-body text-xs text-steel mb-3 max-w-[70ch]">
          Set what each client actually pays to see an estimated MRR above — this is a manual stand-in
          until payments are turned on.
        </p>
        <div className="divide-y divide-steel/15">
          {clients.length === 0 ? (
            <p className="font-body text-sm text-steel py-2">No clients yet.</p>
          ) : (
            clients.map((c) => (
              <div key={c.membershipId} className="py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-body text-sm truncate">{c.fullName}</p>
                  <p className="font-body text-xs text-steel">
                    {c.clientTier ? TIER_LABELS[c.clientTier] ?? c.clientTier : "Tier not set"} &middot;
                    Joined {new Date(c.joinedAt).toLocaleDateString("en-US", { timeZone: displayZone })}
                  </p>
                </div>
                <ClientRateEditor membershipId={c.membershipId} groupId={c.groupId} athleteId={c.athleteId} initialRate={c.monthlyRate} />
              </div>
            ))
          )}
        </div>
      </div>
    </CoachDesktopShell>
  );
}
