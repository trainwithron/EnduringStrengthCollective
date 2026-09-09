import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { RevenueSplitEditor } from "@/components/coach/desktop/revenue-split-editor";
import type { CoachShare } from "@/lib/revenue-splits";

export default async function RevenueSplitsPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = createServerClient();
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
        <p className="font-body text-steel text-center">Only coaches can view revenue splits.</p>
      </main>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", params.groupId)
    .single();

  const { data: orgMembership } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("profile_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!orgMembership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">You&apos;re not part of an organization yet.</p>
      </main>
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("platform_fee_pct")
    .eq("id", orgMembership.organization_id)
    .maybeSingle();

  const { data: memberRows } = await supabase
    .from("organization_memberships")
    .select("profile_id, role, revenue_share_pct, profiles ( full_name )")
    .eq("organization_id", orgMembership.organization_id)
    .order("role", { ascending: true });

  const coaches: CoachShare[] = (memberRows ?? []).map((m) => ({
    profileId: m.profile_id,
    fullName: (m.profiles as any)?.full_name ?? "Unknown",
    role: m.role,
    revenueSharePct: m.revenue_share_pct,
  }));

  // Total estimated revenue for this org: client monthly rates across
  // every group this org owns, plus active/completed challenge entry
  // fees for coaches in this org.
  const { data: orgGroups } = await supabase
    .from("groups")
    .select("id")
    .eq("organization_id", orgMembership.organization_id);
  const orgGroupIds = (orgGroups ?? []).map((g) => g.id);

  const { data: rateRows } = await supabase
    .from("group_memberships")
    .select("monthly_rate")
    .in("group_id", orgGroupIds.length > 0 ? orgGroupIds : ["00000000-0000-0000-0000-000000000000"])
    .eq("role", "athlete");
  const monthlyRateCents = (rateRows ?? []).reduce((sum, r) => sum + Math.round((r.monthly_rate ?? 0) * 100), 0);

  const coachIds = coaches.map((c) => c.profileId);
  const { data: challengeRows } = await supabase
    .from("challenges")
    .select("id, entry_fee_cents")
    .in("coach_id", coachIds.length > 0 ? coachIds : ["00000000-0000-0000-0000-000000000000"])
    .neq("status", "draft");

  let challengeRevenueCents = 0;
  if (challengeRows && challengeRows.length > 0) {
    const challengeIds = challengeRows.map((c) => c.id);
    const { data: participantRows } = await supabase
      .from("challenge_participants")
      .select("challenge_id")
      .in("challenge_id", challengeIds);
    const countByChallenge = new Map<string, number>();
    for (const p of participantRows ?? []) {
      countByChallenge.set(p.challenge_id, (countByChallenge.get(p.challenge_id) ?? 0) + 1);
    }
    for (const c of challengeRows) {
      challengeRevenueCents += (countByChallenge.get(c.id) ?? 0) * c.entry_fee_cents;
    }
  }

  const totalRevenueCents = monthlyRateCents + challengeRevenueCents;
  const isOwner = orgMembership.role === "owner";

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="branding">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">Revenue Splits</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          How estimated revenue would divide between the platform and each coach in your
          organization. Built to plug straight into Stripe Connect transfers later — no payment
          processor is connected yet.
        </p>
      </div>
      <RevenueSplitEditor
        organizationId={orgMembership.organization_id}
        totalRevenueCents={totalRevenueCents}
        initialPlatformFeePct={org?.platform_fee_pct ?? 10}
        coaches={coaches}
        isOwner={isOwner}
      />
      <p className="font-body text-xs text-steel mt-6">
        <Link href={`/groups/${params.groupId}/branding?tab=team`} className="text-rust">
          ← Back to Team
        </Link>
      </p>
    </CoachDesktopShell>
  );
}
