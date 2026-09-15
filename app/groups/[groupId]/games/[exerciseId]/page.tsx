import Link from "next/link";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { CoachDesktopShell } from "@/components/coach/coach-desktop-shell";
import { BottomTabBar } from "@/components/athlete/bottom-tab-bar";
import { LeaderboardRows } from "@/components/leaderboard/leaderboard-rows";
import { GameScoreLogForm } from "@/components/coach/desktop/game-score-log-form";
import { computeGameLeaderboard } from "@/lib/game-leaderboard";

// Per-exercise leaderboard for any "game" exercise (team warm-up games —
// 0175 — or any future one): a coach logs an athlete's score after
// playing, ranked by each athlete's best score. Reached from the
// Exercise Library's per-row link, not its own sidebar destination.
export default async function GameLeaderboardPage(
  props: { params: Promise<{ groupId: string; exerciseId: string }> }
) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: group }, { data: viewerMembership }, { data: exercise }] = await Promise.all([
    supabase.from("groups").select("name").eq("id", params.groupId).single(),
    supabase
      .from("group_memberships")
      .select("role")
      .eq("group_id", params.groupId)
      .eq("profile_id", user.id)
      .maybeSingle(),
    supabase.from("exercise_library").select("id, name").eq("id", params.exerciseId).maybeSingle(),
  ]);

  if (!viewerMembership || !exercise) redirect("/");
  const isCoach = viewerMembership.role === "coach";

  const [{ data: entryRows }, { data: rosterRows }] = await Promise.all([
    supabase
      .from("game_score_entries")
      .select("athlete_id, points, profiles!game_score_entries_athlete_id_fkey ( full_name )")
      .eq("group_id", params.groupId)
      .eq("exercise_name", exercise.name),
    isCoach
      ? supabase
          .from("group_memberships")
          .select("profile_id, profiles ( full_name )")
          .eq("group_id", params.groupId)
          .eq("role", "athlete")
      : Promise.resolve({ data: null }),
  ]);

  const entries = (entryRows ?? []).map((e: any) => ({
    athleteId: e.athlete_id,
    fullName: e.profiles?.full_name ?? "Unknown",
    points: Number(e.points),
  }));
  const ranking = computeGameLeaderboard(entries);

  const roster = ((rosterRows ?? []) as any[])
    .map((r) => ({ profileId: r.profile_id as string, fullName: (r.profiles?.full_name as string) ?? "Unknown" }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const backHref = `/groups/${params.groupId}/exercise-library`;

  const content = (
    <div className="max-w-2xl">
      <Link href={backHref} className="font-body text-xs text-steel uppercase tracking-wide">
        &larr; Back to Exercise Library
      </Link>
      <div className="pb-6 border-b border-steel/20 mb-6 mt-3">
        <h1 className="font-display font-bold text-3xl uppercase leading-none">{exercise.name}</h1>
        <p className="font-body text-sm text-steel mt-2">Ranked by each athlete&apos;s best score.</p>
      </div>

      {isCoach && (
        <GameScoreLogForm groupId={params.groupId} exerciseName={exercise.name} roster={roster} coachId={user.id} />
      )}

      <LeaderboardRows entries={ranking} viewerId={user.id} scoreLabel="pts" />
    </div>
  );

  if (isCoach) {
    return (
      <CoachDesktopShell groupId={params.groupId} groupName={group?.name ?? "Coaching"} active="exercise-library">
        {content}
      </CoachDesktopShell>
    );
  }

  return (
    <main className="min-h-screen bg-graphite text-chalk font-body px-5 py-8 pb-24">
      {content}
      <BottomTabBar groupId={params.groupId} />
    </main>
  );
}
