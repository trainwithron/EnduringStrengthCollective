import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { OneRepMaxCalculator } from "@/components/tools/one-rep-max-calculator";
import { getEffectiveAthlete } from "@/lib/acting-as";

export default async function OneRepMaxPage(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

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

  const effective = await getEffectiveAthlete(params.groupId, user.id);

  if (membership.role === "coach" && !effective.isActingAsOther) {
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", params.groupId)
      .single();

    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="tools">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">
            1RM Calculator
          </h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            Estimate a one-rep max from any logged set, plus common training
            percentages.
          </p>
        </div>
        <OneRepMaxCalculator />
      </CoachDesktopShell>
    );
  }

  let actingAsFullName: string | null = null;
  if (effective.isActingAsOther) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", effective.athleteId)
      .maybeSingle();
    actingAsFullName = profile?.full_name ?? "Client";
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
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">
          1RM Calculator
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Estimate a one-rep max from any set you&apos;ve done, plus common
          training percentages.
        </p>
      </header>

      <section className="px-5 pt-6">
        <OneRepMaxCalculator />
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
