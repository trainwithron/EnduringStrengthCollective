import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { GroupLeaderboardTabs } from "@/components/leaderboard/group-leaderboard-tabs";
import { rankLeaderboard, type LeaderboardEntry } from "@/lib/leaderboard";
import { isPwaStandalone } from "@/lib/pwa-server";

export default async function GroupLeaderboardPage({
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
  const showMobileView = !isCoach || isPwaStandalone();

  // This group's logged activity only — each group's leaderboard is
  // entirely its own, scoped by group_id like everything else here.
  const { data: logs } = await supabase
    .from("workout_logs")
    .select("athlete_id, total_volume, new_prs, profiles ( full_name )")
    .eq("group_id", params.groupId);

  const workoutCountByAthlete = new Map<string, number>();
  const volumeByAthlete = new Map<string, number>();
  const prCountByAthlete = new Map<string, number>();
  const nameByAthlete = new Map<string, string>();

  for (const log of logs ?? []) {
    const id = log.athlete_id;
    nameByAthlete.set(id, (log.profiles as any)?.full_name ?? "Unknown");
    workoutCountByAthlete.set(id, (workoutCountByAthlete.get(id) ?? 0) + 1);
    volumeByAthlete.set(id, (volumeByAthlete.get(id) ?? 0) + (log.total_volume ?? 0));
    prCountByAthlete.set(id, (prCountByAthlete.get(id) ?? 0) + (log.new_prs?.length ?? 0));
  }

  function buildEntries(scoreByAthlete: Map<string, number>): LeaderboardEntry[] {
    return [...nameByAthlete.entries()].map(([profileId, fullName]) => ({
      profileId,
      fullName,
      score: scoreByAthlete.get(profileId) ?? 0,
    }));
  }

  const workoutsRanking = rankLeaderboard(buildEntries(workoutCountByAthlete));
  const volumeRanking = rankLeaderboard(buildEntries(volumeByAthlete));
  const prsRanking = rankLeaderboard(buildEntries(prCountByAthlete));

  if (isCoach && !showMobileView) {
    const { data: group } = await supabase
      .from("groups")
      .select("name")
      .eq("id", params.groupId)
      .single();

    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="leaderboard">
        <div className="pb-6 border-b border-steel/20 mb-6">
          <h1 className="font-display font-bold text-3xl uppercase leading-none">Leaderboard</h1>
          <p className="font-body text-sm text-steel mt-2 max-w-[70ch]">
            Ranked by real logged activity in this group only — objective counts, not a subjective
            score.
          </p>
        </div>
        <GroupLeaderboardTabs
          workouts={workoutsRanking}
          volume={volumeRanking}
          prs={prsRanking}
          viewerId={user.id}
        />
      </CoachDesktopShell>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body pb-24">
      <header className="px-5 pt-8 pb-6 border-b border-steel/20">
        <h1 className="font-display font-bold text-3xl leading-none uppercase">Leaderboard</h1>
        <p className="font-body text-sm text-steel mt-2 max-w-[60ch]">
          Ranked by real logged activity in this group.
        </p>
      </header>
      <section className="px-5 pt-6">
        <GroupLeaderboardTabs
          workouts={workoutsRanking}
          volume={volumeRanking}
          prs={prsRanking}
          viewerId={user.id}
        />
      </section>
      <BottomTabBar groupId={params.groupId} activeOverride="feed" />
    </main>
  );
}
