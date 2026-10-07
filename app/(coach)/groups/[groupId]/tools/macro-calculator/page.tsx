import Link from "next/link";
import { NoAccess } from "@/components/shared/no-access";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { ActingAsBanner } from "@/components/athlete/acting-as-banner";
import { MacroCalculator } from "@/components/tools/macro-calculator";
import { getEffectiveAthlete } from "@/lib/acting-as";

export default async function MacroCalculatorPage(
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
      <NoAccess>This group isn&apos;t available, or you don&apos;t have access to it.</NoAccess>
    );
  }

  const effective = await getEffectiveAthlete(params.groupId, user.id);

  // A coach's calculator is the Calculator tab of Nutrition (old links keep working). A client's own calculator, below, stays on this page.
  if (membership.role === "coach" && !effective.isActingAsOther) {
    redirect(`/groups/${params.groupId}/nutrition?tab=calculator`);
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

  const { data: latestWeightRow } = await supabase
    .from("body_weight_logs")
    .select("weight")
    .eq("athlete_id", effective.athleteId)
    .eq("group_id", params.groupId)
    .order("logged_date", { ascending: false })
    .limit(1)
    .maybeSingle();

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
          Macro Calculator
        </h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Estimate a starting calorie and macro target from your body weight, activity,
          and goal — plus how to find your real maintenance from there.
        </p>
      </header>

      <section className="px-5 pt-6">
        <MacroCalculator initialWeight={latestWeightRow?.weight ?? null} />
        <Link
          href={`/groups/${params.groupId}/nutrition`}
          className="inline-block mt-6 font-body text-sm text-rust"
        >
          Your coach sets your meal plan. See what is planned today &rarr;
        </Link>
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
