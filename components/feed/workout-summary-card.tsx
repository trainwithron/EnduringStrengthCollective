"use client";

import { useEffect, useState } from "react";
import type { FeedPost } from "@/lib/types";
import { ReactionButton } from "./reaction-button";
import { CommentPreview } from "./comment-preview";
import { CoachLoggedBadge } from "@/components/coach-logged-badge";
import { ShareWorkoutButton } from "@/components/share/share-workout-button";
import { PinPostButton } from "./pin-post-button";
import { Dumbbell, Pin } from "lucide-react";

export function WorkoutSummaryCard({
  post,
  viewerId,
  isCoach,
}: {
  post: FeedPost;
  viewerId: string | null;
  isCoach: boolean;
}) {
  const [celebrate, setCelebrate] = useState(false);
  const broadcastLevel = post.workoutSummary?.broadcastLevel ?? "full";
  // A "check-in only" post never reveals PR content, even when one
  // genuinely happened — the whole point is the lightweight badge.
  const hasPrs = broadcastLevel !== "checkin_only" && (post.workoutSummary?.newPrs.length ?? 0) > 0;
  const showStats = broadcastLevel === "full";

  useEffect(() => {
    if (hasPrs) {
      // Fire once on mount — a single orchestrated moment, not a loop.
      const t = setTimeout(() => setCelebrate(true), 150);
      return () => clearTimeout(t);
    }
  }, [hasPrs]);

  const volume = post.workoutSummary?.totalVolume ?? 0;

  return (
    <article
      className={`px-5 py-4 relative overflow-hidden ${
        post.pinnedAt ? "bg-rust/5 border-l-2 border-rust" : ""
      }`}
    >
      {celebrate && <PrBurst />}

      <div className="flex items-center gap-3 mb-3">
        <Avatar name={post.author.fullName} url={post.author.avatarUrl} />
        <div className="flex-1 min-w-0">
          <p className="font-body font-medium text-[15px]">{post.author.fullName}</p>
          <p className="font-body text-xs text-steel">completed a workout</p>
        </div>
        {post.workoutSummary?.loggedByCoach && <CoachLoggedBadge />}
        {post.pinnedAt && !isCoach && (
          <span className="flex items-center gap-1 font-body text-xs text-rust shrink-0">
            <Pin className="w-3.5 h-3.5" fill="currentColor" />
            Pinned
          </span>
        )}
        {isCoach && (
          <div className="shrink-0">
            <PinPostButton postId={post.id} pinned={!!post.pinnedAt} />
          </div>
        )}
      </div>

      <div className="border border-steel/20 p-4 bg-surface/40">
        <div className="flex items-center gap-2 text-rust mb-2">
          <Dumbbell className="w-4 h-4" />
          <span className="font-display uppercase text-sm tracking-wide">
            Workout complete
          </span>
        </div>

        <div className="flex items-end justify-between">
          {showStats ? (
            <div>
              <p className="font-display text-3xl leading-none">
                {Math.round(volume).toLocaleString()}
                <span className="font-body text-sm text-steel ml-1">lbs volume</span>
              </p>
              <p className="font-body text-xs text-steel mt-1">
                {post.workoutSummary?.totalSetsCompleted ?? 0} sets completed
              </p>
            </div>
          ) : (
            <p className="font-body text-sm text-steel">
              {hasPrs ? "New personal record set" : "Checked in"}
            </p>
          )}
          <ShareWorkoutButton
            postId={post.id}
            title={`${post.author.fullName} just finished a workout! 💪`}
          />
        </div>

        {hasPrs && (
          <div className="mt-3 pt-3 border-t border-steel/20">
            <p className="font-display uppercase text-sm text-rust tracking-wide mb-1">
              New PR{post.workoutSummary!.newPrs.length > 1 ? "s" : ""} 🎉
            </p>
            <p className="font-body text-sm">
              {post.workoutSummary!.newPrs.join(", ")}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 mt-3">
        <ReactionButton
          postId={post.id}
          groupId={post.groupId}
          initialCount={post.reactionCount}
          initialReacted={post.viewerHasReacted}
          viewerId={viewerId}
        />
        <CommentPreview postId={post.id} commentCount={post.commentCount} />
      </div>
    </article>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="w-10 h-10 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0">
      <span className="font-display text-sm">{initials}</span>
    </div>
  );
}

function PrBurst() {
  // Pure CSS radiating burst — one-shot, respects reduced motion.
  const bars = Array.from({ length: 10 });
  return (
    <div
      className="absolute inset-0 pointer-events-none flex items-center justify-center motion-reduce:hidden"
      aria-hidden="true"
    >
      {bars.map((_, i) => (
        <span
          key={i}
          className="absolute w-1 h-6 origin-bottom rounded-full"
          style={{
            backgroundColor: i % 2 === 0 ? "#C4622D" : "#6B8F71",
            transform: `rotate(${(360 / bars.length) * i}deg) translateY(-40px)`,
            animation: `pr-burst 700ms ease-out forwards`,
            animationDelay: `${i * 15}ms`,
            opacity: 0,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes pr-burst {
          0% {
            opacity: 1;
            transform: rotate(var(--r, 0deg)) translateY(-10px) scale(0.4);
          }
          100% {
            opacity: 0;
            transform: rotate(var(--r, 0deg)) translateY(-70px) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
