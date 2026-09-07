import type { FeedPost } from "@/lib/types";
import { ReactionButton } from "./reaction-button";
import { CommentPreview } from "./comment-preview";
import { PinPostButton } from "./pin-post-button";
import { Pin } from "lucide-react";

export function UserPostCard({
  post,
  viewerId,
  isCoach,
}: {
  post: FeedPost;
  viewerId: string | null;
  isCoach: boolean;
}) {
  const initials = post.author.fullName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <article className={`px-5 py-4 ${post.pinnedAt ? "bg-rust/5 border-l-2 border-rust" : ""}`}>
      <div className="flex items-center gap-3 mb-3">
        {post.author.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.author.avatarUrl}
            alt=""
            className="w-10 h-10 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-surface border border-steel/30 flex items-center justify-center shrink-0">
            <span className="font-display text-sm">{initials}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-body font-medium text-[15px]">{post.author.fullName}</p>
          <p className="font-body text-xs text-steel">
            {new Date(post.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
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

      {post.body && <p className="font-body text-[15px] mb-3">{post.body}</p>}

      {post.mediaUrl && post.mediaType === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.mediaUrl} alt="" className="w-full border border-steel/20 mb-3" />
      )}
      {post.mediaUrl && post.mediaType === "video" && (
        <video src={post.mediaUrl} controls className="w-full border border-steel/20 mb-3" />
      )}

      <div className="flex items-center gap-4">
        <ReactionButton
          postId={post.id}
          initialCount={post.reactionCount}
          initialReacted={post.viewerHasReacted}
          viewerId={viewerId}
        />
        <CommentPreview postId={post.id} commentCount={post.commentCount} />
      </div>
    </article>
  );
}
