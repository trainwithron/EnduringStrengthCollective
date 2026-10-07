import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { prefersAthleteStyleView } from "@/lib/pwa-server";
import { getEffectiveAthlete } from "@/lib/acting-as";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { ATHLETE_QUICK_TIPS, COACH_QUICK_TIPS, type QuickTip } from "@/lib/quick-tips-content";
import { Lightbulb } from "lucide-react";

function TipList({ tips }: { tips: QuickTip[] }) {
  return (
    <ol className="space-y-5">
      {tips.map((tip, i) => (
        <li key={i} className="border border-steel/20 p-4">
          <div className="flex items-start gap-3">
            <Lightbulb className="w-4 h-4 text-rust shrink-0 mt-0.5" />
            <div>
              <p className="font-body text-sm font-bold text-chalk">{tip.hook}</p>
              <p className="font-body text-sm text-steel mt-1.5 leading-relaxed">{tip.detail}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default async function QuickTipsPage(
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

  if (!membership) {
    return (
      <NoAccess>This group isn&apos;t available, or you don&apos;t have access to it.</NoAccess>
    );
  }

  const isCoach = membership.role === "coach";
  const effective = await getEffectiveAthlete(params.groupId, user.id);
  const showMobileView = effective.isActingAsOther || !isCoach || (await prefersAthleteStyleView());

  let actingAsFullName: string | null = null;
  if (effective.isActingAsOther) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", effective.athleteId)
      .maybeSingle();
    actingAsFullName = profile?.full_name ?? "Client";
  }

  if (isCoach && !showMobileView) {
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", params.groupId)
      .single();

    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="quick-tips">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Quick Tips</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            Real, specific things this app already does — each tied to a feature that&apos;s
            actually live, not generic advice.
          </p>
        </div>
        <TipList tips={COACH_QUICK_TIPS} />
      </CoachDesktopShell>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      {effective.isActingAsOther && (
        <ActingAsBanner athleteFullName={actingAsFullName ?? "Client"} groupId={params.groupId} />
      )}
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <Link
          href={`/groups/${params.groupId}/settings`}
          className="font-body text-xs text-steel uppercase tracking-wide"
        >
          &larr; Back to settings
        </Link>
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">Quick Tips</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          A few things worth knowing about how this app actually works.
        </p>
      </header>

      <section className="px-5 pt-6">
        <TipList tips={ATHLETE_QUICK_TIPS} />
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
