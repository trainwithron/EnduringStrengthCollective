import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSharedWorkout } from "@/lib/shared-workout";
import { loadFeedProtectedIds } from "@/lib/post-name-protection-server";
import { protectAuthor } from "@/lib/post-name-protection";

// Powers the in-feed "expand" on a workout card — same data the public
// /share/[postId] page shows, just fetched on demand instead of always
// paying for it in the feed's initial load. Authenticated + a normal
// group-member RLS read (not the anon path /share uses), so this only
// ever returns something for someone who could already see the post.
export async function GET(_request: Request, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Only someone who can already see this post (a member of its group) gets it; the post is looked up with the
  // viewer's own access first, because the shared-workout reader itself is public by link.
  const { data: visible } = await supabase.from("posts").select("id").eq("id", params.postId).maybeSingle();
  if (!visible) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const shared = await getSharedWorkout(params.postId, { fullName: true });
  if (!shared) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only the person who did the workout, or the group's coach, can make a picture of it to post elsewhere.
  let canShare = shared.authorId === user.id;
  if (!canShare) {
    const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", shared.groupId).eq("profile_id", user.id).maybeSingle();
    canShare = membership?.role === "coach";
  }
  // The author and the group's coach see the name in full. Everyone else sees what the feed shows: a first name and last initial and no photo for anyone who is not a confirmed adult (the expanded card must not give
  // a minor's full name or photo to a teammate when the card in the feed above it does not).
  if (!canShare) {
    const protectedIds = await loadFeedProtectedIds([shared.authorId]);
    const author = protectAuthor({ id: shared.authorId, fullName: shared.athleteName, avatarUrl: shared.athleteAvatarUrl }, protectedIds);
    return NextResponse.json({ ...shared, athleteName: author.fullName, athleteAvatarUrl: author.avatarUrl, canShare });
  }
  return NextResponse.json({ ...shared, canShare });
}
