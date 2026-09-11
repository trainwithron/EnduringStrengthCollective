"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  getGroupLeaderboardRankings,
  getPositionLeaderboardRankings,
  type GroupLeaderboardRankings,
} from "@/lib/leaderboard-data";
import type { PositionRanking } from "@/lib/leaderboard";
import { GroupLeaderboardTabs } from "./group-leaderboard-tabs";
import { PositionLeaderboard } from "./position-leaderboard";

// The rankings below were a one-shot server fetch sitting above a feed
// that otherwise updates live — a workout completed by anyone in the
// group changed the real standings immediately, but this card only ever
// caught up on a full page reload. Recomputes from scratch (cheap: one
// query over the group's workout_logs, same as the initial server fetch)
// whenever any workout_logs row for this group changes, rather than
// trying to patch three separate rankings incrementally.
export function LiveGroupLeaderboard({
  groupId,
  initialRankings,
  initialPositionGroups,
  viewerId,
}: {
  groupId: string;
  initialRankings: GroupLeaderboardRankings;
  // null = team_mode is off for this group — skip position fetching and
  // the view toggle entirely, zero extra cost for the common case.
  initialPositionGroups: PositionRanking[] | null;
  viewerId: string | null;
}) {
  const [rankings, setRankings] = useState(initialRankings);
  const [positionGroups, setPositionGroups] = useState(initialPositionGroups);
  const [view, setView] = useState<"roster" | "position">("roster");

  useEffect(() => {
    const supabase = createBrowserClient();

    const realtimeChannel = supabase
      .channel(`leaderboard:${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "workout_logs", filter: `group_id=eq.${groupId}` },
        async () => {
          const fresh = await getGroupLeaderboardRankings(supabase, groupId);
          setRankings(fresh);
          if (initialPositionGroups !== null) {
            setPositionGroups(await getPositionLeaderboardRankings(supabase, groupId));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const hasRealPositions = (positionGroups ?? []).some((g) => g.positionId !== null);

  return (
    <div>
      {hasRealPositions && (
        <div className="flex items-center gap-1 mb-4">
          {(["roster", "position"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`h-8 px-3 font-body text-xs border ${
                view === v ? "border-rust text-rust" : "border-steel/30 text-steel"
              }`}
            >
              {v === "roster" ? "Whole Roster" : "By Position"}
            </button>
          ))}
        </div>
      )}

      {view === "position" && hasRealPositions ? (
        <PositionLeaderboard positionGroups={positionGroups!} viewerId={viewerId} />
      ) : (
        <GroupLeaderboardTabs
          workouts={rankings.workoutsRanking}
          volume={rankings.volumeRanking}
          prs={rankings.prsRanking}
          viewerId={viewerId}
        />
      )}
    </div>
  );
}
