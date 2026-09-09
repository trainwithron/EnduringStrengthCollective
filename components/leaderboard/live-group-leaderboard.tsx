"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { getGroupLeaderboardRankings, type GroupLeaderboardRankings } from "@/lib/leaderboard-data";
import { GroupLeaderboardTabs } from "./group-leaderboard-tabs";

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
  viewerId,
}: {
  groupId: string;
  initialRankings: GroupLeaderboardRankings;
  viewerId: string | null;
}) {
  const [rankings, setRankings] = useState(initialRankings);

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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [groupId]);

  return (
    <GroupLeaderboardTabs
      workouts={rankings.workoutsRanking}
      volume={rankings.volumeRanking}
      prs={rankings.prsRanking}
      viewerId={viewerId}
    />
  );
}
