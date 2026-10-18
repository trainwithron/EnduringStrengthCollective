import { LoadFailedPage } from "@/components/ui/load-failed-page";
import { isReadFailure } from "@/lib/read-failed";
import Link from "next/link";
import { redirectOneOnOneToAnchor } from "@/lib/coach-wide-redirect";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BrandingForm } from "@/components/coach/desktop/branding-form";
import { InviteCoachForm } from "@/components/coach/desktop/invite-coach-form";
import { FrontDeskList } from "@/components/org/front-desk-list";
import { ExportBusinessButton } from "@/components/coach/desktop/export-business-button";
import { TeamMembersPanel } from "@/components/org/team-members-panel";
import { loadTeamInfo } from "@/lib/org-team";
import { TransferOwnershipButton } from "@/components/coach/desktop/transfer-ownership-button";
import { WorkoutCardBackgroundSettings } from "@/components/coach/desktop/workout-card-background-settings";
import { DispatchSettings } from "@/components/coach/desktop/dispatch-settings";
import { MarketplaceListingToggle } from "@/components/coach/desktop/marketplace-listing-toggle";
import { MarketplacePersonControl } from "@/components/coach/desktop/marketplace-person-control";
import { ClientTagManager } from "@/components/coach/desktop/client-tag-manager";
import { TerminologySettingsPanel } from "@/components/coach/desktop/terminology-settings-panel";
import { CoachCreditsPanel } from "@/components/coach/desktop/coach-credits-panel";
import { PlanBillingPanel } from "@/components/coach/desktop/plan-billing-panel";
import { getOrgBillingSummary } from "@/lib/org-billing-server";
import { isBillingEnforced } from "@/lib/org-entitlements";
import type { ButtonShape, DisplayFont, BodyFont } from "@/lib/theme";
import { isStripeConfigured } from "@/lib/stripe";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { loadPendingInvitees } from "@/lib/coach-invite-server";
import { ALL_BRAND_FONTS, googleFontsHref } from "@/lib/google-fonts";

export const metadata = { title: "Branding" };

type OrgTab = "team" | "branding" | "workout-card" | "tags" | "dispatch" | "terminology" | "credits" | "plan";

export default async function BrandingPage(
  props: {
    params: Promise<{ groupId: string }>;
    searchParams: Promise<{ tab?: string }>;
  }
) {
  const params = await props.params;
  await redirectOneOnOneToAnchor(params.groupId, "branding");
  const searchParams = await props.searchParams;
  const tab: OrgTab =
    searchParams.tab === "branding"
      ? "branding"
      : searchParams.tab === "workout-card"
        ? "workout-card"
        : searchParams.tab === "tags"
          ? "tags"
          : searchParams.tab === "dispatch"
            ? "dispatch"
            : searchParams.tab === "terminology"
              ? "terminology"
              : searchParams.tab === "credits"
                ? "credits"
                : searchParams.tab === "plan"
                  ? "plan"
                  : "team";
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
      <NoAccess>Only coaches can customize dashboard branding.</NoAccess>
    );
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name, organization_id")
    .eq("id", params.groupId)
    .single();

  // Scoped to THIS group's own organization, not a blind "whichever org
  // this profile happens to belong to" lookup — a coach who owns/admins
  // more than one organization (e.g. running several client orgs) has
  // more than one row in organization_memberships, and an unscoped
  // lookup here would silently show the wrong org's Team page.
  const { data: orgMembership } = group?.organization_id
    ? await supabase
        .from("organization_memberships")
        .select("organization_id, role")
        .eq("organization_id", group.organization_id)
        .eq("profile_id", user.id)
        .maybeSingle()
    : { data: null };

  if (!orgMembership) {
    return (
      <NoAccess>You&apos;re not part of an organization yet.</NoAccess>
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select(
      "id, slug, name, owner_id, created_at, button_shape, accent_color, background_color, text_color, font_display, font_body, logo_url, app_icon_url, workout_card_background_mode, workout_card_background_url, dispatch_ttl_minutes, zip_code"
    )
    .eq("id", orgMembership.organization_id)
    .maybeSingle();

  // Separate so a database without the setting yet still renders the page (the toggle is then hidden).
  const { data: listingRow, error: listingError } = await supabase
    .from("organizations")
    .select("listed_in_marketplace")
    .eq("id", orgMembership.organization_id)
    .maybeSingle();

  // The coach's own listing choice (separate read: a database without the columns yet just hides the control).
  const { data: personRow, error: personError } = await supabase.from("profiles").select("marketplace_listed, marketplace_display_name").eq("id", user.id).maybeSingle();

  const { data: memberRows } = await supabase
    .from("organization_memberships")
    .select("profile_id, role, profiles ( full_name )")
    .eq("organization_id", orgMembership.organization_id)
    .order("role", { ascending: true });
  // Who is marked leaving (migration 0396): a separate read, so a database without the column yet just shows no marks.
  const { data: leavingRows } = await supabase.from("organization_memberships").select("profile_id, fired_at").eq("organization_id", orgMembership.organization_id).not("departing_since", "is", null);
  const leavingIds = new Set((leavingRows ?? []).map((r: { profile_id: string }) => r.profile_id));
  const firedIds = new Set(((leavingRows ?? []) as { profile_id: string; fired_at: string | null }[]).filter((r) => r.fired_at).map((r) => r.profile_id));

  // Who the owner has let read the clients' health answers (a separate read: a database without the table yet just shows nobody).
  const { data: grantRows } = await supabase.from("health_access_grants").select("profile_id").eq("organization_id", orgMembership.organization_id);
  const healthAccessIds = new Set(((grantRows ?? []) as { profile_id: string }[]).map((r) => r.profile_id));

  const members = (memberRows ?? []).map((m) => ({
    profileId: m.profile_id,
    leaving: leavingIds.has(m.profile_id),
    fired: firedIds.has(m.profile_id),
    role: m.role,
    fullName: (m.profiles as any)?.full_name ?? "Unknown",
  }));

  const teamInfo = tab === "team" ? await loadTeamInfo(supabase, orgMembership.organization_id) : null;

  // The front desk (Release T1): the people invited only to check clients in. Not organization members, so listed apart. Two links point at profiles, so the one that names the person is spelled out.
  const { data: frontDeskRows, error: frontDeskError } =
    tab === "team"
      ? await supabase.from("org_front_desk").select("profile_id, profiles!org_front_desk_profile_id_fkey ( full_name )").eq("organization_id", orgMembership.organization_id)
      : { data: null, error: null };
  const frontDesk = ((frontDeskRows ?? []) as unknown as { profile_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }[]).map((r) => ({
    profileId: r.profile_id,
    fullName: (Array.isArray(r.profiles) ? r.profiles[0]?.full_name : r.profiles?.full_name) ?? "Unknown",
  }));

  // Invitations nobody has accepted yet (people invited by a new address: their account exists, never confirmed and never signed in). Listed under Invitations, with Send again / Copy link / Cancel, and left out of the
  // member lists below. Only for an owner or admin; a person whose account cannot be read is not listed as pending on a guess.
  const pendingInvitees =
    tab === "team" && (orgMembership.role === "owner" || orgMembership.role === "admin")
      ? await loadPendingInvitees(createServiceRoleClient(), [
          ...members.filter((m) => m.role !== "owner").map((m) => ({ profileId: m.profileId, name: m.fullName, role: String(m.role) })),
          ...frontDesk.map((p) => ({ profileId: p.profileId, name: p.fullName, role: "front_desk" })),
        ])
      : [];
  const pendingIds = new Set(pendingInvitees.map((p) => p.profileId));

  const { data: tagRows } = await supabase
    .from("client_tags")
    .select("id, name, gates_revenue_split")
    .eq("organization_id", orgMembership.organization_id)
    .order("name", { ascending: true });
  const clientTags = (tagRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    gatesRevenueSplit: t.gates_revenue_split,
  }));

  // credit_topup_low_tier_monetization_idea.md — scoped to THIS coach
  // (user.id), never the org: a coach's AI credits are their own
  // personal purchase from the platform, not shared across an org's
  // other coaches the way branding/tags are.
  const [{ data: creditsRow }, { data: liftOffRow }] = await Promise.all([
    supabase.from("coach_credits").select("balance, ai_access_mode").eq("coach_id", user.id).maybeSingle(),
    supabase.from("lift_off_subscriptions").select("status").eq("coach_id", user.id).maybeSingle(),
  ]);
  const coachCreditBalance = creditsRow?.balance ?? 0;
  const coachCreditsUnlimited = creditsRow?.ai_access_mode === "unlimited";
  const liftOffActive = liftOffRow?.status === "active";

  const isOwner = orgMembership.role === "owner";
  const isOwnerOrAdmin = orgMembership.role === "owner" || orgMembership.role === "admin";
  const basePath = `/groups/${params.groupId}/branding`;

  // Plan & Billing is invisible until COACH_BILLING_ENFORCED is on, except
  // to the platform admin, who can preview it (and an org's real state)
  // before anything is switched on for coaches.
  const { data: viewerProfile } = await supabase
    .from("profiles")
    .select("is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();
  const showPlanTab = isBillingEnforced() || viewerProfile?.is_platform_admin === true;
  const planSummary =
    showPlanTab && tab === "plan" && org
      ? await getOrgBillingSummary(supabase, orgMembership.organization_id, org.created_at)
      : null;

  return (
    <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="branding">
      <div className="pb-6 border-b border-steel/20 mb-6">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">
          {org?.name ?? "Organization"}
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
          Every coach and group under this organization shares one identity — branding, and
          eventually billing, are set here rather than per-coach.
        </p>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto">
        <Link
          href={`${basePath}?tab=team`}
          className={`h-9 px-4 flex items-center shrink-0 whitespace-nowrap font-body text-sm border ${
            tab === "team" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          Team
        </Link>
        <Link
          href={`${basePath}?tab=branding`}
          className={`h-9 px-4 flex items-center shrink-0 whitespace-nowrap font-body text-sm border ${
            tab === "branding" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          Branding
        </Link>
        <Link
          href={`${basePath}?tab=workout-card`}
          className={`h-9 px-4 flex items-center shrink-0 whitespace-nowrap font-body text-sm border ${
            tab === "workout-card" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          Workout Card
        </Link>
        <Link
          href={`${basePath}?tab=tags`}
          className={`h-9 px-4 flex items-center shrink-0 whitespace-nowrap font-body text-sm border ${
            tab === "tags" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          Tags
        </Link>
        {isOwnerOrAdmin && (
          <Link
            href={`${basePath}?tab=dispatch`}
            className={`h-9 px-4 flex items-center shrink-0 whitespace-nowrap font-body text-sm border ${
              tab === "dispatch" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
            }`}
          >
            Coach Dispatch
          </Link>
        )}
        <Link
          href={`${basePath}?tab=terminology`}
          className={`h-9 px-4 flex items-center shrink-0 whitespace-nowrap font-body text-sm border ${
            tab === "terminology" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          What You Call Things
        </Link>
        <Link
          href={`${basePath}?tab=credits`}
          className={`h-9 px-4 flex items-center shrink-0 whitespace-nowrap font-body text-sm border ${
            tab === "credits" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
          }`}
        >
          Credits
        </Link>
        {showPlanTab && (
          <Link
            href={`${basePath}?tab=plan`}
            className={`h-9 px-4 flex items-center shrink-0 whitespace-nowrap font-body text-sm border ${
              tab === "plan" ? "bg-rust text-graphite border-rust" : "border-steel/30 text-steel"
            }`}
          >
            Plan &amp; Billing
          </Link>
        )}
      </div>

      {tab === "team" ? (
        <div>
          <MarketplaceListingToggle
            organizationId={orgMembership.organization_id}
            initialListed={!!listingRow?.listed_in_marketplace}
            canEdit={isOwnerOrAdmin}
            available={!listingError && !!listingRow}
          />
          <MarketplacePersonControl
            profileId={user.id}
            initialListed={!!(personRow as { marketplace_listed?: boolean } | null)?.marketplace_listed}
            initialName={(personRow as { marketplace_display_name?: string | null } | null)?.marketplace_display_name ?? ""}
            available={!personError && !!personRow}
          />
          <div className="border border-steel/20 p-4 mb-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <p className="font-body text-xs text-steel uppercase tracking-wide mb-1">
                Organization
              </p>
              <p className="font-body text-sm">{org?.name}</p>
              <p className="font-body text-xs text-steel mt-0.5">/{org?.slug}</p>
              <p className="font-body text-xs text-steel mt-2">
                Created {org?.created_at ? new Date(org.created_at).toLocaleDateString() : "—"}
              </p>
            </div>
          </div>

          {teamInfo?.failed && (
            <p className="font-body text-xs text-rust mb-4" role="alert">
              Some of this list could not be read, so the client counts may be low. Reload to try again.
            </p>
          )}
          <TeamMembersPanel
            groupId={params.groupId}
            organizationId={orgMembership.organization_id}
            organizationName={org?.name ?? "this organization"}
            me={user.id}
            myRole={orgMembership.role}
            newInvites={pendingInvitees}
            members={members.filter((m) => !pendingIds.has(m.profileId)).map((m) => ({ profileId: m.profileId, fullName: m.fullName, role: m.role, clients: teamInfo?.clientCounts[m.profileId] ?? 0, soleClients: teamInfo?.soleCoachOfClients[m.profileId] ?? 0, leaving: m.leaving, fired: m.fired, healthAccess: healthAccessIds.has(m.profileId) }))}
            invites={teamInfo?.invites ?? []}
          />

          {frontDeskError ? (
            <p className="font-body text-xs text-rust mb-4" role="alert">
              The front desk list could not be read. Reload to try again.
            </p>
          ) : (
            <FrontDeskList organizationId={orgMembership.organization_id} organizationName={org?.name ?? "this organization"} people={frontDesk.filter((p) => !pendingIds.has(p.profileId))} canManage={isOwnerOrAdmin} />
          )}

          {isOwnerOrAdmin && (
            <div className="mb-8 flex flex-wrap items-start gap-4">
              <InviteCoachForm groupId={params.groupId} />
              {isOwner && (
                <TransferOwnershipButton
                  organizationId={orgMembership.organization_id}
                  candidates={members
                    .filter((m) => m.profileId !== user.id && !m.leaving)
                    .map((m) => ({ profileId: m.profileId, fullName: m.fullName }))}
                />
              )}
            </div>
          )}

          <div className="mb-8">
            <ExportBusinessButton groupId={params.groupId} />
          </div>

          <p className="font-body text-xs text-steel">
            <Link href={`/groups/${params.groupId}/revenue-splits`} className="text-rust">
              View Revenue Splits →
            </Link>
          </p>
        </div>
      ) : tab === "tags" ? (
        isOwnerOrAdmin ? (
          <ClientTagManager organizationId={orgMembership.organization_id} coachId={user.id} initialTags={clientTags} />
        ) : (
          <p className="font-body text-sm text-steel">
            Only owners and admins can manage client tags.
          </p>
        )
      ) : tab === "dispatch" ? (
        isOwnerOrAdmin ? (
          <DispatchSettings
            organizationId={orgMembership.organization_id}
            orgSlug={org?.slug ?? ""}
            initialTtlMinutes={org?.dispatch_ttl_minutes ?? 20}
          />
        ) : (
          <p className="font-body text-sm text-steel">
            Only owners and admins can manage coach dispatch.
          </p>
        )
      ) : tab === "terminology" ? (
        <TerminologySettingsPanel />
      ) : tab === "plan" ? (
        planSummary ? (
          <PlanBillingPanel summary={planSummary} isOwner={isOwner} orgName={org?.name ?? "Organization"} />
        ) : (
          <p className="font-body text-sm text-steel">Plan &amp; Billing isn&apos;t available yet.</p>
        )
      ) : tab === "credits" ? (
        <CoachCreditsPanel
          purchaseAvailable={isStripeConfigured() && !!process.env.STRIPE_PRICE_COACH_CREDIT_PACK}
          groupId={params.groupId}
          balance={coachCreditBalance}
          unlimited={coachCreditsUnlimited}
          liftOffActive={liftOffActive}
        />
      ) : !isOwner ? (
        <p className="font-body text-sm text-steel">
          Only {org?.name ?? "the organization"}&apos;s owner can change branding.
        </p>
      ) : tab === "branding" ? (
        <>
        {/* The layout loads only the fonts a page shows; here a coach compares every one of them, so this page asks for the full set. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={googleFontsHref(ALL_BRAND_FONTS)} precedence="default" />
        <BrandingForm
          organizationId={orgMembership.organization_id}
          initialButtonShape={(org?.button_shape as ButtonShape) ?? "sharp"}
          initialAccentColor={org?.accent_color ?? "#D2703B"}
          initialBackgroundColor={org?.background_color ?? "#1C1B1A"}
          initialTextColor={org?.text_color ?? "#EDE8E0"}
          initialFontDisplay={(org?.font_display as DisplayFont) ?? "Barlow Condensed"}
          initialFontBody={(org?.font_body as BodyFont) ?? "Inter"}
          initialLogoUrl={org?.logo_url ?? null}
          initialAppIconUrl={org?.app_icon_url ?? null}
          initialZipCode={org?.zip_code ?? null}
        />
        </>
      ) : (
        <WorkoutCardBackgroundSettings
          organizationId={orgMembership.organization_id}
          initialMode={(org?.workout_card_background_mode as "default_rotation" | "custom") ?? "default_rotation"}
          initialUrl={org?.workout_card_background_url ?? null}
        />
      )}
    </CoachDesktopShell>
  );
}
