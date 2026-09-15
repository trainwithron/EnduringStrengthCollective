import { rankLeaderboard, type LeaderboardEntry } from "@/lib/leaderboard";

export interface GameScoreEntry {
  athleteId: string;
  fullName: string;
  points: number;
}

// One athlete can log a game's score more than once (they play again next
// practice) — the leaderboard ranks by each athlete's BEST score, same
// personal-best framing as every other leaderboard/PR surface in this
// app, not a running total. Reuses rankLeaderboard unchanged rather than
// reimplementing tie logic (this app's established leaderboard pattern).
// Only athletes with at least one real entry appear — same "don't show
// zero-activity noise" rule getGroupLeaderboardRankings already uses.
export function computeGameLeaderboard(entries: GameScoreEntry[]): (LeaderboardEntry & { rank: number })[] {
  const bestByAthlete = new Map<string, LeaderboardEntry>();
  for (const entry of entries) {
    const existing = bestByAthlete.get(entry.athleteId);
    if (!existing || entry.points > existing.score) {
      bestByAthlete.set(entry.athleteId, {
        profileId: entry.athleteId,
        fullName: entry.fullName,
        score: entry.points,
      });
    }
  }
  return rankLeaderboard([...bestByAthlete.values()]);
}
