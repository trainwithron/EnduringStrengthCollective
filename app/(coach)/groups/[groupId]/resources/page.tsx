import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import Link from "next/link";
import { inOrg, orgIdOfGroup } from "@/lib/org-of-group";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import {
  ReferralDirectoryManager,
  type ReferralPartner,
} from "@/components/coach/desktop/referral-directory-manager";
import { ReferralDirectoryList } from "@/components/athlete/referral-directory-list";
import { ProShopManager, type ProShopLink } from "@/components/coach/desktop/pro-shop-manager";
import { ProShopList } from "@/components/athlete/pro-shop-list";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { getCoachedGroups, groupsInOrgOf } from "@/lib/coach-groups";
import { linksForViewer } from "@/lib/shelf";
import { loadShelfViewer } from "@/lib/shelf-viewer";

export const metadata = { title: "Resources" };

type ResourceTab = "referrals" | "shop";

export default async function ResourcesPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ tab?: string }>;
  }
) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const tab: ResourceTab = searchParams.tab === "shop" ? "shop" : "referrals";
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

  if (!membership) {
    return (
      <NoAccess>This group isn&apos;t available, or you don&apos;t have access to it.</NoAccess>
    );
  }

  const isCoach = membership.role === "coach";
  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const isActingAsOther = effective.isActingAsOther;
  const showMobileView = isActingAsOther || !isCoach || await prefersAthleteStyleView();

  let actingAsFullName: string | null = null;
  if (isActingAsOther) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", effective.athleteId)
      .maybeSingle();
    actingAsFullName = profile?.full_name ?? "Client";
  }

  // Both directories are coach-scoped, shared across every group that
  // coach runs — same resolution as before the merge.
  let coachId = user.id;
  if (!isCoach) {
    const { data: coachMembership } = await supabase
      .from("group_memberships")
      .select("profile_id")
      .eq("group_id", params.groupId)
      .eq("role", "coach")
      .limit(1)
      .maybeSingle();
    coachId = coachMembership?.profile_id ?? user.id;
  }

  // The shop and the partners are the organization's: the one the page's group is in.
  const organizationId = await orgIdOfGroup(supabase, params.groupId);
  const [{ data: referralRows }, { data: shopRows }] = await Promise.all([
    inOrg(
      supabase
        .from("referral_partners")
        .select("id, name, specialty, description, booking_url, discount_code, discount_description, click_count")
        .eq("coach_id", coachId),
      organizationId
    ).order("created_at", { ascending: true }),
    inOrg(
      supabase
        .from("pro_shop_links")
        .select("id, title, category, description, url, image_url, discount_code, discount_description, click_count, featured, show_on_public, audience, audience_group_id")
        .eq("coach_id", coachId),
      organizationId
    ).order("created_at", { ascending: true }),
  ]);

  const partners: ReferralPartner[] = (referralRows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    description: r.description,
    bookingUrl: r.booking_url,
    discountCode: r.discount_code,
    discountDescription: r.discount_description,
    clickCount: r.click_count,
  }));

  const links: ProShopLink[] = (shopRows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    description: r.description,
    url: r.url,
    imageUrl: r.image_url,
    discountCode: r.discount_code,
    discountDescription: r.discount_description,
    clickCount: r.click_count,
    featured: !!(r as { featured?: boolean }).featured,
    showOnPublic: (r as { show_on_public?: boolean }).show_on_public === true,
    audience: (r as { audience?: string }).audience ?? "everyone",
    audienceGroupId: (r as { audience_group_id?: string | null }).audience_group_id ?? null,
  }));

  // What this viewer may see: a coach sees all of it; a client (or the person a coach is acting as) sees the cards open to them.
  const shelfGroupKind = ((await supabase.from("groups").select("group_kind").eq("id", params.groupId).maybeSingle()).data as { group_kind?: string } | null)?.group_kind ?? null;
  const shelfViewer = await loadShelfViewer(supabase, { groupKind: shelfGroupKind, athleteId: effective.athleteId ?? user.id, coachPreview: isCoach && !isActingAsOther });
  const shownLinks = linksForViewer(links, shelfViewer);

  const tabBar = (basePath: string) => (
    <div className="flex gap-2 mb-6">
      <Link
        href={`${basePath}?tab=referrals`}
        className={`h-9 px-4 flex items-center font-body text-sm border ${
          tab === "referrals" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
        }`}
      >
        Referrals
      </Link>
      <Link
        href={`${basePath}?tab=shop`}
        className={`h-9 px-4 flex items-center font-body text-sm border ${
          tab === "shop" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
        }`}
      >
        Pro Shop
      </Link>
    </div>
  );

  if (isCoach && !showMobileView) {
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", params.groupId)
      .single();
    // The team and social groups a card can be limited to.
    const coachedGroups = await getCoachedGroups(supabase, user.id);
    const audienceGroups = groupsInOrgOf(coachedGroups, params.groupId)
      .filter((g) => g.kind !== "one_on_one")
      .map((g) => ({ id: g.id, name: g.name }));

    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="resources">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Resources</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            Everything you point clients to outside the app — local practitioners with direct
            booking, and your own merch/supplements/coaching links. Click counts feed into your
            Business dashboard.
          </p>
        </div>
        {tabBar(`/groups/${params.groupId}/resources`)}
        {tab === "referrals" ? (
          <ReferralDirectoryManager initialPartners={partners} organizationId={organizationId} />
        ) : (
          <ProShopManager initialLinks={links} organizationId={organizationId} groups={audienceGroups} />
        )}
      </CoachDesktopShell>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}/settings`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to settings
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">Resources</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Practitioners and shopping links your coach recommends.
        </p>
      </header>

      <section className="px-5 pt-6">
        {tabBar(`/groups/${params.groupId}/resources`)}
        {tab === "referrals" ? <ReferralDirectoryList partners={partners} /> : <ProShopList links={shownLinks} />}
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
