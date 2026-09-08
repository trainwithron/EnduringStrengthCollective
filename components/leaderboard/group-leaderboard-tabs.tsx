"use client";

import { useState } from "react";
import type { LeaderboardEntry } from "@/lib/leaderboard";

type RankedEntry = LeaderboardEntry & { rank: number };

const TABS = ["workouts", "volume", "prs"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  workouts: "Most Workouts",
  volume: "Most Volume",
  prs: "Most PRs",
};

const SCORE_LABEL: Record<Tab, string> = {
  workouts: "workouts",
  volume: "lbs",
  prs: "PRs",
};

export function GroupLeaderboardTabs({
  workouts,
  volume,
  prs,
  viewerId,
}: {
  workouts: RankedEntry[];
  volume: RankedEntry[];
  prs: RankedEntry[];
  viewerId: string | null;
}) {
  const [tab, setTab] = useState<Tab>("workouts");
  const data: Record<Tab, RankedEntry[]> = { workouts, volume, prs };
  const active = data[tab];

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-steel/20 mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-10 px-4 font-body text-sm border-b-2 transition-colors ${
              tab === t ? "border-rust text-chalk" : "border-transparent text-steel active:text-chalk"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {active.length === 0 ? (
        <p className="font-body text-sm text-steel">No activity logged yet.</p>
      ) : (
        <div className="divide-y divide-steel/15">
          {active.map((entry) => (
            <div key={entry.profileId} className="py-2.5 flex items-center justify-between">
              <span className="font-body text-sm">
                <span className="text-steel mr-2 w-6 inline-block">#{entry.rank}</span>
                {entry.fullName}
                {entry.profileId === viewerId && <span className="text-rust"> (you)</span>}
              </span>
              <span className="font-body text-xs text-steel">
                {Math.round(entry.score).toLocaleString()} {SCORE_LABEL[tab]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
