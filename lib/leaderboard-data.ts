import type { SupabaseClient } from "@supabase/supabase-js";
import { shownName } from "@/lib/shown-name";
import type { ProtectIds } from "@/lib/minor-names";
import { onSharedBoards } from "@/lib/board-visibility";
import { readPositionRoster } from "@/lib/group-roster-reads";
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

  // A client who joined this group from their own one-on-one space and shares their workouts here (step 202) counts with the workouts they shared: the cards on this group's feed whose workout was
  // logged in their own space. A client who joined but keeps their workouts private has no such cards, so they are not on the board. The same sharing-level rule applies.
  for (const shared of await readSharedWorkoutCards(supabase, groupId)) {
    const id = shared.athleteId;
    if (!onSharedBoards(shared.broadcastLevel)) continue;
    rawNameByAthlete.set(id, shared.fullName);
    workoutCountByAthlete.set(id, (workoutCountByAthlete.get(id) ?? 0) + 1);
    volumeByAthlete.set(id, (volumeByAthlete.get(id) ?? 0) + shared.totalVolume);
    prCountByAthlete.set(id, (prCountByAthlete.get(id) ?? 0) + shared.prCount);
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

export interface SharedWorkoutCard {
  athleteId: string;
  fullName: string | null;
  broadcastLevel: string | null;
  totalVolume: number;
  prCount: number;
}

// The workout cards on this group's feed for workouts logged in another group (a client's own one-on-one space), each workout once, only when the card's author is the one who did the workout.
// The members read those workouts through the shared-card rule (step 202); before it, or for a card that is not readable, the workout is simply missing and nothing is counted.
export function sharedWorkoutCardsFromPosts(groupId: string, rows: any[]): SharedWorkoutCard[] {
  const seen = new Set<string>();
  const out: SharedWorkoutCard[] = [];
  for (const row of rows ?? []) {
    const log = Array.isArray(row?.workout_logs) ? row.workout_logs[0] : row?.workout_logs;
    if (!log || !row.workout_log_id || seen.has(row.workout_log_id)) continue;
    if (log.athlete_id !== row.author_id || !log.group_id || log.group_id === groupId) continue;
    seen.add(row.workout_log_id);
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    out.push({
      athleteId: row.author_id,
      fullName: profile?.full_name ?? null,
      broadcastLevel: profile?.feed_broadcast_level ?? null,
      totalVolume: log.total_volume ?? 0,
      prCount: log.new_prs?.length ?? 0,
    });
  }
  return out;
}

async function readSharedWorkoutCards(supabase: SupabaseClient, groupId: string): Promise<SharedWorkoutCard[]> {
  const { data, error } = await supabase
    .from("posts")
    .select("author_id, workout_log_id, workout_logs ( athlete_id, group_id, total_volume, new_prs ), profiles!posts_author_id_fkey ( full_name, feed_broadcast_level )")
    .eq("group_id", groupId)
    .eq("post_type", "workout_summary")
    .not("workout_log_id", "is", null);
  if (error) return [];
  return sharedWorkoutCardsFromPosts(groupId, data ?? []);
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
  // The athletes with their position, through the narrow read (migration 0404): a name, a position and how they share their activity, nothing else about anyone.
  const [memberships, { data: logs }] = await Promise.all([
    readPositionRoster(supabase, groupId),
    supabase
      .from("workout_logs")
      .select("athlete_id, total_volume, new_prs")
      .eq("group_id", groupId),
  ]);

  const shownMembers = (memberships ?? []).filter((m) => onSharedBoards(m.feedBroadcastLevel));
  const protectedIds = await protect(shownMembers.map((m) => m.profileId));
  const roster: RosterAthlete[] = shownMembers.map((m) => ({
    profileId: m.profileId,
    fullName: shownName(m.fullName, m.profileId, protectedIds),
    positionId: m.positionId,
    positionName: m.positionName,
    positionSortOrder: m.positionSortOrder,
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
