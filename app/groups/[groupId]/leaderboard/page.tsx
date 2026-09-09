import { redirect } from "next/navigation";

// The leaderboard now lives at the top of Team Feed's General channel
// instead of its own tab — kept as a redirect so any old bookmarked/
// shared link still lands somewhere real.
export default async function LeaderboardRedirect(
  props: {
    params: Promise<{ groupId: string }>;
  }
) {
  const params = await props.params;
  redirect(`/groups/${params.groupId}/feed?channel=general`);
}
