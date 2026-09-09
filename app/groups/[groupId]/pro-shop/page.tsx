import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ProShopManager, type ProShopLink } from "@/components/coach/desktop/pro-shop-manager";
import { ProShopList } from "@/components/athlete/pro-shop-list";
import { prefersAthleteStyleView } from "@/lib/pwa-server";

export default async function ProShopPage(
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

  // Athletes see their coach's Pro Shop; a coach manages their own —
  // either way this resolves to the same coach_id (links are coach-scoped,
  // shared across every group that coach runs), same pattern as Referrals.
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
    .from("pro_shop_links")
    .select("id, title, category, description, url, image_url, discount_code, discount_description, click_count")
    .eq("coach_id", coachId)
    .order("created_at", { ascending: true });

  const links: ProShopLink[] = (rows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    description: r.description,
    url: r.url,
    imageUrl: r.image_url,
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
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="pro-shop">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Pro Shop</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            Merch, supplements, coaching applications, your own site — anywhere you want a client
            to spend money through your own ecosystem instead of somewhere else. Click counts feed
            into your Business dashboard.
          </p>
        </div>
        <ProShopManager initialLinks={links} />
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
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">Pro Shop</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Merch, supplements, and more from your coach.
        </p>
      </header>

      <section className="px-5 pt-6">
        <ProShopList links={links} />
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
