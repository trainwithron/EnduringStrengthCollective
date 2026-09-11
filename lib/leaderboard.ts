// Generic objective-ranking math — shared by challenge leaderboards and
// per-group leaderboards. "Objective" per the original ask: rank by a
// real countable number (workouts, volume, PRs, habit check-offs), never
// a subjective/aesthetic score.

export interface LeaderboardEntry {
  profileId: string;
  fullName: string;
  score: number;
}

export function rankLeaderboard(entries: LeaderboardEntry[]): (LeaderboardEntry & { rank: number })[] {
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  let rank = 0;
  let prevScore: number | null = null;
  return sorted.map((entry, i) => {
    if (prevScore === null || entry.score !== prevScore) {
      rank = i + 1;
      prevScore = entry.score;
    }
    return { ...entry, rank };
  });
}

// Position-aware ranking — comparing a lineman's volume against a wide
// receiver's isn't a fair ranking, so a team_mode group buckets its
// roster by group_memberships.position_id and ranks each bucket on its
// own, reusing rankLeaderboard unchanged rather than reimplementing the
// tie logic. depth_order (starter/2nd string) is deliberately not used
// here — that's a separate, coach-assigned concept, not a fairness axis.
export interface RosterAthlete {
  profileId: string;
  fullName: string;
  positionId: string | null;
  positionName: string | null; // ignored when positionId is null
  positionSortOrder: number | null;
}

export interface PositionRanking {
  positionId: string | null; // null = "Unassigned"
  positionName: string;
  workoutsRanking: (LeaderboardEntry & { rank: number })[];
  volumeRanking: (LeaderboardEntry & { rank: number })[];
  prsRanking: (LeaderboardEntry & { rank: number })[];
}

export function rankByPosition(
  roster: RosterAthlete[],
  scoresByAthlete: {
    workouts: Map<string, number>;
    volume: Map<string, number>;
    prs: Map<string, number>;
  }
): PositionRanking[] {
  const buckets = new Map<string, RosterAthlete[]>();
  for (const athlete of roster) {
    const key = athlete.positionId ?? "__unassigned__";
    const bucket = buckets.get(key);
    if (bucket) bucket.push(athlete);
    else buckets.set(key, [athlete]);
  }

  function entriesFor(bucket: RosterAthlete[], scores: Map<string, number>): LeaderboardEntry[] {
    return bucket.map((a) => ({
      profileId: a.profileId,
      fullName: a.fullName,
      score: scores.get(a.profileId) ?? 0,
    }));
  }

  const withSortOrder = [...buckets.entries()].map(([key, bucket]) => {
    const isUnassigned = key === "__unassigned__";
    const ranking: PositionRanking = {
      positionId: isUnassigned ? null : key,
      positionName: isUnassigned ? "Unassigned" : bucket[0].positionName ?? "Unassigned",
      workoutsRanking: rankLeaderboard(entriesFor(bucket, scoresByAthlete.workouts)),
      volumeRanking: rankLeaderboard(entriesFor(bucket, scoresByAthlete.volume)),
      prsRanking: rankLeaderboard(entriesFor(bucket, scoresByAthlete.prs)),
    };
    const sortOrder = isUnassigned ? Infinity : bucket[0].positionSortOrder ?? 0;
    return { ranking, sortOrder };
  });

  return withSortOrder.sort((a, b) => a.sortOrder - b.sortOrder).map((r) => r.ranking);
}
