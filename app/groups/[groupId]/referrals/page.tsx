import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import {
  ReferralDirectoryManager,
  type ReferralPartner,
} from "@/components/coach/desktop/referral-directory-manager";
import { ReferralDirectoryList } from "@/components/athlete/referral-directory-list";
import { prefersAthleteStyleView } from "@/lib/pwa-server";

export default async function ReferralsPage({
  params,
}: {
  params: { groupId: string };
}) {
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

  if (!membership) {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">
          This group isn&apos;t available, or you don&apos;t have access to it.
        </p>
      </main>
    );
  }

  const isCoach = membership.role === "coach";
  const showMobileView = !isCoach || prefersAthleteStyleView();

  // Athletes see their coach's directory; a coach manages their own —
  // either way this resolves to the same coach_id (referral partners are
  // coach-scoped, shared across every group that coach runs).
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

  const { data: rows } = await supabase
    .from("referral_partners")
    .select("id, name, specialty, description, booking_url, discount_code, discount_description, click_count")
    .eq("coach_id", coachId)
    .order("created_at", { ascending: true });

  const partners: ReferralPartner[] = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    specialty: r.specialty,
    description: r.description,
    bookingUrl: r.booking_url,
    discountCode: r.discount_code,
    discountDescription: r.discount_description,
    clickCount: r.click_count,
  }));

  if (isCoach && !showMobileView) {
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", params.groupId)
      .single();

    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="referrals">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">
            Referral Directory
          </h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            Local practitioners your clients can book directly — massage, chiro, PT, and more.
            Click counts feed into your Business dashboard.
          </p>
        </div>
        <ReferralDirectoryManager initialPartners={partners} />
      </CoachDesktopShell>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}/settings`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to settings
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">
          Referral Directory
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Practitioners your coach recommends, with direct booking and member perks.
        </p>
      </header>

      <section className="px-5 pt-6">
        <ReferralDirectoryList partners={partners} />
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
