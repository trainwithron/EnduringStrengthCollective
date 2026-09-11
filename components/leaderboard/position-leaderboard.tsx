"use client";

import { useState } from "react";
import type { PositionRanking } from "@/lib/leaderboard";
import { LeaderboardRows, TABS, TAB_LABELS, SCORE_LABEL, type LeaderboardTab } from "./leaderboard-rows";

export function PositionLeaderboard({
  positionGroups,
  viewerId,
}: {
  positionGroups: PositionRanking[];
  viewerId: string | null;
}) {
  const [tab, setTab] = useState<LeaderboardTab>("workouts");
  const rankingKey =
    tab === "workouts" ? "workoutsRanking" : tab === "volume" ? "volumeRanking" : "prsRanking";

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

      <div className="space-y-5">
        {positionGroups.map((group) => (
          <div key={group.positionId ?? "unassigned"}>
            <h4 className="font-body text-xs text-steel uppercase tracking-wide mb-1.5">
              {group.positionName}
            </h4>
            <LeaderboardRows
              entries={group[rankingKey]}
              viewerId={viewerId}
              scoreLabel={SCORE_LABEL[tab]}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
