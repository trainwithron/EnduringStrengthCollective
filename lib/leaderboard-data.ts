import type { SupabaseClient } from "@supabase/supabase-js";
import { rankLeaderboard, rankByPosition, type LeaderboardEntry, type RosterAthlete, type PositionRanking } from "@/lib/leaderboard";

type RankedEntry = LeaderboardEntry & { rank: number };

export interface GroupLeaderboardRankings {
  workoutsRanking: RankedEntry[];
  volumeRanking: RankedEntry[];
  prsRanking: RankedEntry[];
}

// This group's logged activity only — each group's leaderboard is
// entirely its own, scoped by group_id like everything else here.
// Shared by the Team Feed's General channel (leaderboard now lives at
// the top of it, not its own nav tab) and anything else that wants the
// same rankings.
export async function getGroupLeaderboardRankings(
  supabase: SupabaseClient,
  groupId: string
): Promise<GroupLeaderboardRankings> {
  const { data: logs } = await supabase
    .from("workout_logs")
    .select("athlete_id, total_volume, new_prs, profiles ( full_name )")
    .eq("group_id", groupId);

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

  return {
    workoutsRanking: rankLeaderboard(buildEntries(workoutCountByAthlete)),
    volumeRanking: rankLeaderboard(buildEntries(volumeByAthlete)),
    prsRanking: rankLeaderboard(buildEntries(prCountByAthlete)),
  };
}

// Position-grouped version of the same rankings, for team_mode groups —
// ranking a lineman against a wide receiver on "most volume" isn't a fair
// comparison, so this buckets by group_memberships.position_id instead of
// one flat roster ranking. Unlike getGroupLeaderboardRankings above
// (which only ever shows an athlete who has at least one workout_log
// row), this includes every athlete on the roster at a score of 0 if
// they haven't logged anything — a bounded position group should show
// who isn't showing up in the numbers, not just quietly omit them.
export async function getPositionLeaderboardRankings(
  supabase: SupabaseClient,
  groupId: string
): Promise<PositionRanking[]> {
  const [{ data: memberships }, { data: logs }] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("profile_id, position_id, profiles ( full_name ), group_positions ( name, sort_order )")
      .eq("group_id", groupId)
      .eq("role", "athlete"),
    supabase
      .from("workout_logs")
      .select("athlete_id, total_volume, new_prs")
      .eq("group_id", groupId),
  ]);

  const roster: RosterAthlete[] = (memberships ?? []).map((m: any) => ({
    profileId: m.profile_id,
    fullName: m.profiles?.full_name ?? "Unknown",
    positionId: m.position_id ?? null,
    positionName: m.group_positions?.name ?? null,
    positionSortOrder: m.group_positions?.sort_order ?? null,
  }));

  const workouts = new Map<string, number>();
  const volume = new Map<string, number>();
  const prs = new Map<string, number>();
  for (const log of logs ?? []) {
    const id = log.athlete_id;
    workouts.set(id, (workouts.get(id) ?? 0) + 1);
    volume.set(id, (volume.get(id) ?? 0) + (log.total_volume ?? 0));
    prs.set(id, (prs.get(id) ?? 0) + (log.new_prs?.length ?? 0));
  }

  return rankByPosition(roster, { workouts, volume, prs });
}
