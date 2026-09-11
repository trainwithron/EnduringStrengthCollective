import type { LeaderboardEntry } from "@/lib/leaderboard";

export type RankedEntry = LeaderboardEntry & { rank: number };

export const TABS = ["workouts", "volume", "prs"] as const;
export type LeaderboardTab = (typeof TABS)[number];

export const TAB_LABELS: Record<LeaderboardTab, string> = {
  workouts: "Most Workouts",
  volume: "Most Volume",
  prs: "Most PRs",
};

export const SCORE_LABEL: Record<LeaderboardTab, string> = {
  workouts: "workouts",
  volume: "lbs",
  prs: "PRs",
};

export function LeaderboardRows({
  entries,
  viewerId,
  scoreLabel,
}: {
  entries: RankedEntry[];
  viewerId: string | null;
  scoreLabel: string;
}) {
  if (entries.length === 0) {
    return <p className="font-body text-sm text-steel">No activity logged yet.</p>;
  }

  return (
    <div className="divide-y divide-steel/15">
      {entries.map((entry) => (
        <div key={entry.profileId} className="py-2.5 flex items-center justify-between">
          <span className="font-body text-sm">
            <span className="text-steel mr-2 w-6 inline-block">#{entry.rank}</span>
            {entry.fullName}
            {entry.profileId === viewerId && <span className="text-rust"> (you)</span>}
          </span>
          <span className="font-body text-xs text-steel">
            {Math.round(entry.score).toLocaleString()} {scoreLabel}
          </span>
        </div>
      ))}
    </div>
  );
}
