import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { ClientRateEditor } from "@/components/coach/desktop/client-rate-editor";
import {
  computeEstimatedMRR,
  computeEngagement,
  computeMonthlyGrowth,
  computeRealIncomeThisMonth,
  computeRealMRR,
  computeActivePayingClients,
} from "@/lib/business-metrics";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

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
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("group_memberships")
    .select("role")
    .eq("group_id", params.groupId)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membership?.role !== "coach") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">Only coaches can view the business dashboard.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  // Every group this coach runs — the business view spans the whole
  // coaching business, not just whichever group happens to be open.
  const { data: coachedGroups } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach");
  const groupIds = (coachedGroups ?? []).map((g) => g.group_id);

  const { data: memberRows } = await supabase
    .from("group_memberships")
    .select("id, group_id, profile_id, joined_at, client_tier, monthly_rate, profiles ( full_name )")
    .in("group_id", groupIds.length > 0 ? groupIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("role", "athlete")
    .order("joined_at", { ascending: false });

  const clients = (memberRows ?? []).map((m) => ({
    membershipId: m.id,
    groupId: m.group_id,
    athleteId: m.profile_id,
    fullName: (m.profiles as any)?.full_name ?? "Unknown",
    joinedAt: m.joined_at as string,
    clientTier: m.client_tier as string | null,
    monthlyRate: m.monthly_rate as number | null,
  }));

  const uniqueAthleteIds = new Set(clients.map((c) => c.athleteId));

  const { data: creditRows } = await supabase
    .from("session_credits")
    .select("athlete_id, group_id, balance")
    .in("group_id", groupIds.length > 0 ? groupIds : ["00000000-0000-0000-0000-000000000000"]);
  const totalOutstandingCredits = (creditRows ?? []).reduce((sum, r) => sum + (r.balance ?? 0), 0);

  const { data: logRows } = await supabase
    .from("workout_logs")
    .select("athlete_id, created_at")
    .in("group_id", groupIds.length > 0 ? groupIds : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: false });
  const lastActiveByAthlete = new Map<string, string>();
  for (const log of logRows ?? []) {
    if (!lastActiveByAthlete.has(log.athlete_id)) {
      lastActiveByAthlete.set(log.athlete_id, dateKey(new Date(log.created_at)));
    }
  }

  const today = new Date();
  const todayKey = dateKey(today);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const { count: bookingsThisMonthCount } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("coach_id", user.id)
    .eq("status", "confirmed")
    .gte("start_at", monthStart.toISOString());

  const { data: referralRows } = await supabase
    .from("referral_partners")
    .select("click_count")
    .eq("coach_id", user.id);
  const totalReferralClicks = (referralRows ?? []).reduce((sum, r) => sum + (r.click_count ?? 0), 0);

  const { data: proShopRows } = await supabase
    .from("pro_shop_links")
    .select("click_count")
    .eq("coach_id", user.id);
  const totalProShopClicks = (proShopRows ?? []).reduce((sum, r) => sum + (r.click_count ?? 0), 0);

  // Real, Stripe-sourced figures — additive to the manual-rate estimate
  // below, not a replacement. A coach with no packages configured yet
  // simply gets 0 here and keeps seeing the estimate as their only signal.
  const safeGroupIds = groupIds.length > 0 ? groupIds : ["00000000-0000-0000-0000-000000000000"];
  const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  const { data: purchaseRows } = await supabase
    .from("credit_purchases")
    .select("athlete_id, amount_cents, created_at")
    .in("group_id", safeGroupIds);

  const { data: subscriptionRows } = await supabase
    .from("membership_subscriptions")
    .select("athlete_id, price_cents, status")
    .in("group_id", safeGroupIds);

  const realIncomeThisMonth = computeRealIncomeThisMonth(
    (purchaseRows ?? []).map((p) => ({
      amountCents: p.amount_cents,
      createdAtDateKey: dateKey(new Date(p.created_at)),
    })),
    monthKey
  );
  const realMRR = computeRealMRR(
    (subscriptionRows ?? []).map((s) => ({
      priceCents: s.price_cents,
      status: s.status as "active" | "past_due" | "canceled" | "incomplete",
    }))
  );

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
    const d = new Date(c.joinedAt);
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
  }).length;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="business">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Business</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          A snapshot across every group you coach.{" "}
          {realMRR > 0 || realIncomeThisMonth > 0
            ? "Income and MRR below are real, from your connected packages."
            : "Set up packages to see real income and MRR here — until then, the manual rate estimate below is your only signal."}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">${realIncomeThisMonth.toLocaleString()}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Income this month</p>
          <p className="font-body text-[11px] text-steel mt-0.5">Real, from purchased packages</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">
            ${(realMRR > 0 ? realMRR : estimatedMRR).toLocaleString()}
          </p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
            {realMRR > 0 ? "MRR" : "Estimated MRR"}
          </p>
          <p className="font-body text-[11px] text-steel mt-0.5">
            {realMRR > 0 ? "From active subscriptions" : "From rates set below"}
          </p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{uniqueAthleteIds.size}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Roster size</p>
          {newThisMonth > 0 && (
            <p className="font-body text-[11px] text-positive mt-0.5">+{newThisMonth} this month</p>
          )}
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{payingClientsCount}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Paying clients</p>
          <p className="font-body text-[11px] text-steel mt-0.5">Active subscription or unused credits</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{totalOutstandingCredits}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">
            Outstanding session credits
          </p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{bookingsThisMonthCount ?? 0}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Sessions this month</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{totalReferralClicks}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Referral clicks</p>
        </div>
        <div className="border border-steel/20 p-4">
          <p className="font-display text-3xl leading-none">{totalProShopClicks}</p>
          <p className="font-body text-xs text-steel mt-1 uppercase tracking-wide">Pro Shop clicks</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div className="border border-steel/20 p-4">
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
            Client growth (last 6 months)
          </h2>
          <div className="flex items-end gap-3 h-28">
            {growth.map((g) => (
              <div key={g.monthLabel} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="font-body text-[11px] text-chalk">{g.count}</span>
                <div
                  className="w-full bg-rust"
                  style={{ height: `${Math.max(4, (g.count / maxGrowthCount) * 80)}px` }}
                />
                <span className="font-body text-[9px] text-steel">{g.monthLabel}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-steel/20 p-4">
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
          Client rates
        </h2>
        <p className="font-body text-xs text-steel mb-3 max-w-[70ch]">
          Set what each client actually pays to see an estimated MRR above — this is a manual stand-in
          until real billing is connected.
        </p>
        <div className="divide-y divide-steel/15">
          {clients.length === 0 ? (
            <p className="font-body text-sm text-steel py-2">No clients yet.</p>
          ) : (
            clients.map((c) => (
              <div key={c.membershipId} className="py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-body text-sm truncate">{c.fullName}</p>
                  <p className="font-body text-[11px] text-steel">
                    {c.clientTier ? TIER_LABELS[c.clientTier] ?? c.clientTier : "Tier not set"} &middot;
                    Joined {new Date(c.joinedAt).toLocaleDateString()}
                  </p>
                </div>
                <ClientRateEditor membershipId={c.membershipId} initialRate={c.monthlyRate} />
              </div>
            ))
          )}
        </div>
      </div>
    </CoachDesktopShell>
  );
}
