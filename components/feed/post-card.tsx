import type { FeedPost } from "@/lib/types";
import { WorkoutSummaryCard } from "./workout-summary-card";
import { UserPostCard } from "./user-post-card";

export function PostCard({
  post,
  viewerId,
  isCoach,
}: {
  post: FeedPost;
  viewerId: string | null;
  isCoach: boolean;
}) {
  if (post.postType === "workout_summary" && post.workoutSummary) {
    return <WorkoutSummaryCard post={post} viewerId={viewerId} isCoach={isCoach} />;
  }
  return <UserPostCard post={post} viewerId={viewerId} isCoach={isCoach} />;
}
