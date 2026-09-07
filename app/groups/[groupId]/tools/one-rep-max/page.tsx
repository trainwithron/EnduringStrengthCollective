import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { OneRepMaxCalculator } from "@/components/tools/one-rep-max-calculator";

export default async function OneRepMaxPage({
  params,
}: {
  params: { groupId: string };
}) {
  const supabase = createServerClient();
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

  if (membership.role === "coach") {
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
