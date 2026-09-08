"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@/lib/supabase/client";
import type { FeedChannel, FeedPost } from "@/lib/types";
import { PostCard } from "./post-card";

export function FeedList({
  groupId,
  initialPosts,
  viewerId,
  channel,
  isCoach,
}: {
  groupId: string;
  initialPosts: FeedPost[];
  viewerId: string | null;
  channel: FeedChannel;
  isCoach: boolean;
}) {
  const [posts, setPosts] = useState(initialPosts);

  useEffect(() => {
    const supabase = createBrowserClient();

    // New posts arrive live. We refetch just the one row (with joins) rather
    // than trusting the raw payload, since the INSERT event won't include
    // author/reaction/comment joins.
    const realtimeChannel = supabase
      .channel(`feed:${groupId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts", filter: `group_id=eq.${groupId}` },
        async (payload) => {
          // Belongs to a channel the viewer isn't currently looking at.
          if (payload.new.channel !== channel) return;

          const { data } = await supabase
            .from("posts")
            .select(
              `
              id, post_type, channel, pinned_at, body, media_url, media_type, created_at, broadcast_level,
              profiles!posts_author_id_fkey ( id, full_name, avatar_url ),
              workout_logs ( total_volume, total_sets_completed, new_prs, logged_by_coach ),
              reactions ( profile_id ),
              comments ( id )
            `
            )
            .eq("id", payload.new.id)
            .single();

          if (data) {
            const shaped: FeedPost = {
              id: data.id,
              groupId,
              postType: data.post_type,
              channel: data.channel,
              pinnedAt: data.pinned_at,
              body: data.body,
              mediaUrl: data.media_url,
              mediaType: data.media_type,
              createdAt: data.created_at,
              author: {
                id: (data.profiles as any).id,
                fullName: (data.profiles as any).full_name,
                avatarUrl: (data.profiles as any).avatar_url,
              },
              workoutSummary: data.workout_logs
                ? {
                    totalVolume: (data.workout_logs as any).total_volume,
                    totalSetsCompleted: (data.workout_logs as any).total_sets_completed,
                    newPrs: (data.workout_logs as any).new_prs ?? [],
                    loggedByCoach: (data.workout_logs as any).logged_by_coach ?? false,
                    broadcastLevel: (data as any).broadcast_level ?? "full",
                  }
                : null,
              reactionCount: (data.reactions ?? []).length,
              viewerHasReacted: (data.reactions ?? []).some(
                (r: any) => r.profile_id === viewerId
              ),
              commentCount: (data.comments ?? []).length,
            };
            // A brand-new post is never pre-pinned, but re-sort anyway so it
            // lands after any already-pinned posts rather than always at
            // the very top.
            setPosts((prev) =>
              [shaped, ...prev].sort((a, b) => {
                const pinDiff = (b.pinnedAt ? 1 : 0) - (a.pinnedAt ? 1 : 0);
                if (pinDiff !== 0) return pinDiff;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              })
            );
          }
        }
      )
      // Reaction/comment count changes update live counts on existing cards.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reactions" },
        (payload) => {
          const postId = (payload.new as any)?.post_id ?? (payload.old as any)?.post_id;
          if (!postId) return;
          setPosts((prev) =>
            prev.map((p) =>
              p.id === postId
                ? {
                    ...p,
                    reactionCount:
                      payload.eventType === "INSERT"
                        ? p.reactionCount + 1
                        : Math.max(0, p.reactionCount - 1),
                  }
                : p
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments" },
        (payload) => {
          const postId = (payload.new as any).post_id;
          setPosts((prev) =>
            prev.map((p) =>
              p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "comments" },
        (payload) => {
          const postId = (payload.old as any).post_id;
          setPosts((prev) =>
            prev.map((p) =>
              p.id === postId ? { ...p, commentCount: Math.max(0, p.commentCount - 1) } : p
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(realtimeChannel);
    };
  }, [groupId, viewerId, channel]);

  if (posts.length === 0) {
    return (
      <p className="font-body text-sm text-steel px-5 py-10">
        No posts yet. Finish a workout or share something to get the feed going.
      </p>
    );
  }

  return (
    <div className="divide-y divide-steel/15">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} viewerId={viewerId} isCoach={isCoach} />
      ))}
    </div>
  );
}
