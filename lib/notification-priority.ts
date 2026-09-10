// Ron's own stated priority order (see long_term_feature_backlog.md,
// "Notification priority tiers"): 1-on-1 clients get prompt, direct
// notifications for their own activity; big groups/challenges should
// NOT flood the coach with per-post noise — the one thing worth
// surfacing from a big group is a question that's gone unanswered a
// while. Both halves are plain, testable functions so the actual
// trigger call sites (complete-workout-button.tsx, the feed composers,
// the Home dashboard) stay thin wrappers around this logic.

// A 1-on-1 client's own activity (a logged workout, a new post/comment)
// is worth an immediate push to their coach — a big/online-tier group's
// isn't, on the theory that a coach with dozens of team members can't
// absorb a push for every single one of them.
export function isHighPriorityClient(clientTier: string | null): boolean {
  return clientTier === "one_on_one";
}

export interface CommentActivity {
  postId: string;
  groupId: string;
  authorId: string;
  createdAt: string; // ISO
}

export interface StaleThread {
  postId: string;
  groupId: string;
  lastCommentAt: string;
}

// A thread "needs a reply" when its most recent comment isn't from the
// coach and has sat for longer than the staleness window — a read-time
// heuristic (no scheduled job needed) for surfacing a quiet question in
// a group that isn't already on the 1-on-1 fast path above.
//
// `dismissedAt` (postId -> ISO timestamp) is the manual "clear this"
// escape hatch — a thread the coach dismissed stays cleared only up to
// that moment: a newer non-coach reply after the dismissal makes the
// thread reappear, since that's a genuinely new thing to respond to.
export function findThreadsNeedingReply(
  comments: CommentActivity[],
  coachId: string,
  now: Date,
  staleAfterHours = 8,
  dismissedAt: Map<string, string> = new Map()
): StaleThread[] {
  const latestByPost = new Map<string, CommentActivity>();
  for (const c of comments) {
    const existing = latestByPost.get(c.postId);
    if (!existing || new Date(c.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latestByPost.set(c.postId, c);
    }
  }

  const staleMs = staleAfterHours * 60 * 60 * 1000;
  const result: StaleThread[] = [];
  for (const latest of latestByPost.values()) {
    if (latest.authorId === coachId) continue;
    if (now.getTime() - new Date(latest.createdAt).getTime() < staleMs) continue;

    const dismissed = dismissedAt.get(latest.postId);
    if (dismissed && new Date(dismissed).getTime() >= new Date(latest.createdAt).getTime()) continue;

    result.push({ postId: latest.postId, groupId: latest.groupId, lastCommentAt: latest.createdAt });
  }
  return result;
}
