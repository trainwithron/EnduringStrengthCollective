import type { SupabaseClient } from "@supabase/supabase-js";
import { rankLeaderboard, type LeaderboardEntry } from "@/lib/leaderboard";

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
