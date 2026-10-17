import type { SupabaseClient } from "@supabase/supabase-js";
import { shownName } from "@/lib/shown-name";
import type { ProtectIds } from "@/lib/minor-names";
import { onSharedBoards } from "@/lib/board-visibility";
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
  groupId: string,
  // Says which of the members on the board are not confirmed adults (lib/minor-names.ts, looked up on the server for the ids actually shown): they are shown as first name and last initial.
  protect: ProtectIds
): Promise<GroupLeaderboardRankings> {
  const { data: logs } = await supabase.from("workout_logs").select("athlete_id, total_volume, new_prs, profiles ( full_name, feed_broadcast_level )").eq("group_id", groupId);

  const workoutCountByAthlete = new Map<string, number>();
  const volumeByAthlete = new Map<string, number>();
  const prCountByAthlete = new Map<string, number>();
  const nameByAthlete = new Map<string, string>();
  const rawNameByAthlete = new Map<string, string | null>();

  for (const log of logs ?? []) {
    const id = log.athlete_id;
    // A client who keeps their activity private, or shares only that they checked in, is not ranked (their numbers are not for the board).
    if (!onSharedBoards((log.profiles as any)?.feed_broadcast_level)) continue;
    rawNameByAthlete.set(id, (log.profiles as any)?.full_name ?? null);
    workoutCountByAthlete.set(id, (workoutCountByAthlete.get(id) ?? 0) + 1);
    volumeByAthlete.set(id, (volumeByAthlete.get(id) ?? 0) + (log.total_volume ?? 0));
    prCountByAthlete.set(id, (prCountByAthlete.get(id) ?? 0) + (log.new_prs?.length ?? 0));
  }

  // The names are shortened for everyone on the board who is not a confirmed adult, whether or not they are still a member.
  const protectedIds = await protect([...rawNameByAthlete.keys()]);
  for (const [id, raw] of rawNameByAthlete) nameByAthlete.set(id, shownName(raw, id, protectedIds));

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
  groupId: string,
  protect: ProtectIds
): Promise<PositionRanking[]> {
  const [{ data: memberships }, { data: logs }] = await Promise.all([
    supabase
      .from("group_memberships")
      .select("profile_id, position_id, profiles ( full_name, feed_broadcast_level ), group_positions ( name, sort_order )")
      .eq("group_id", groupId)
      .eq("role", "athlete"),
    supabase
      .from("workout_logs")
      .select("athlete_id, total_volume, new_prs")
      .eq("group_id", groupId),
  ]);

  const shownMembers = (memberships ?? []).filter((m: any) => onSharedBoards(m.profiles?.feed_broadcast_level));
  const protectedIds = await protect(shownMembers.map((m: any) => m.profile_id as string));
  const roster: RosterAthlete[] = shownMembers.map((m: any) => ({
    profileId: m.profile_id,
    fullName: shownName(m.profiles?.full_name, m.profile_id, protectedIds),
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
