import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { GoalProposalForm } from "@/components/athlete/goal-proposal-form";
import { GOAL_TYPE_LABELS } from "@/lib/goal-types";
import type { GoalType } from "@/lib/goal-reversal";

// Client always sets/owns the goal (goal_date_aware_nutrition_and_
// programming_idea.md) — this is deliberately an athlete-only page, not
// a coach-authored one. The coach confirms from the client's profile
// page instead of proposing here.
export default async function GoalPage(props: { params: Promise<{ groupId: string }> }) {
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

  if (membership?.role !== "athlete") {
    return (
      <main className="min-h-screen bg-graphite text-chalk flex items-center justify-center px-6">
        <p className="font-body text-steel text-center">This page is for clients to set their own goal.</p>
      </main>
    );
  }

  const { data: goals } = await supabase
    .from("client_goals")
    .select("id, goal_type, custom_label, target_date, priority_note, status, created_at")
    .eq("athlete_id", user.id)
    .eq("group_id", params.groupId)
    .order("created_at", { ascending: false });

  const current = (goals ?? [])[0] ?? null;
  const history = (goals ?? []).slice(1);

  function labelFor(goalType: string, customLabel: string | null) {
    return goalType === "custom" && customLabel ? customLabel : GOAL_TYPE_LABELS[goalType as GoalType] ?? goalType;
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
        <h1 className="font-display font-bold text-3xl leading-none mt-3 uppercase">My Goal</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Set what you&apos;re actually working toward — your coach sees it and confirms it before it changes
          anything.
        </p>
      </header>

      <section className="px-5 pt-6">
      {current && (
        <div className="border border-steel/20 p-4 mb-6">
          <p className="font-body text-[10px] text-steel uppercase tracking-wide font-bold mb-1">
            {current.status === "confirmed" ? "Current goal" : current.status === "proposed" ? "Waiting on your coach" : "Declined"}
          </p>
          <p className="font-body text-lg">{labelFor(current.goal_type, current.custom_label)}</p>
          {current.target_date && (
            <p className="font-body text-sm text-steel mt-1">Target date: {current.target_date}</p>
          )}
          {current.priority_note && <p className="font-body text-sm text-steel mt-1">{current.priority_note}</p>}
        </div>
      )}

      <div className="border border-steel/20 p-4 mb-6">
        <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-3">
          {current ? "Propose a change" : "Set your goal"}
        </h2>
        <GoalProposalForm athleteId={user.id} groupId={params.groupId} />
      </div>

      {history.length > 0 && (
        <div>
          <h2 className="font-display uppercase text-sm tracking-wide text-steel mb-2">History</h2>
          <div className="divide-y divide-steel/15">
            {history.map((g) => (
              <div key={g.id} className="py-2">
                <p className="font-body text-sm">{labelFor(g.goal_type, g.custom_label)}</p>
                <p className="font-body text-xs text-steel">
                  {g.status} · {new Date(g.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      </section>

      <BottomTabBar groupId={params.groupId} activeOverride="settings" />
    </main>
  );
}
