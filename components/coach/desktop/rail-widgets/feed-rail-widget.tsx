"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import { RailWidgetHeader, RailWidgetRow, RailWidgetDeeperLink, RailWidgetEmpty, RailWidgetLoading } from "./rail-widget-shell";

interface RecentActivity {
  id: string;
  authorName: string;
  summary: string;
}

// Hover rail widgets (hover_expand_rail_widgets_idea.md) — Team Feed
// icon. Same `posts` columns/join the real Team Feed page already
// selects (POST_SELECT in app/groups/[groupId]/feed/page.tsx) — this
// only asks for a smaller slice of the same shape, not a different query
// against different columns.
export function FeedRailWidget({ groupId }: { groupId: string }) {
  const [activity, setActivity] = useState<RecentActivity[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("posts")
        .select(
          `
          id, post_type, body,
          profiles!posts_author_id_fkey ( full_name ),
          workout_logs ( new_prs )
        `
        )
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(3);

      const shaped: RecentActivity[] = (data ?? []).map((p: any) => {
        const authorName = p.profiles?.full_name ?? "Someone";
        const prs: string[] = p.workout_logs?.new_prs ?? [];
        const summary =
          p.post_type === "workout_summary"
            ? prs.length > 0
              ? `New PR — ${prs[0]}`
              : "Logged a workout"
            : (p.body ?? "").slice(0, 60);
        return { id: p.id, authorName, summary };
      });
      if (!cancelled) setActivity(shaped);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  return (
    <div>
      <RailWidgetHeader title="Recent activity" />
      {activity === null ? (
        <RailWidgetLoading />
      ) : activity.length === 0 ? (
        <RailWidgetEmpty text="No posts yet." />
      ) : (
        <div>
          {activity.map((a) => (
            <RailWidgetRow key={a.id} primary={a.authorName} secondary={a.summary} />
          ))}
        </div>
      )}
      <RailWidgetDeeperLink href={`/groups/${groupId}/feed`} label="Open Team Feed" />
    </div>
  );
}
