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
