import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getSharedWorkout } from "@/lib/shared-workout";

// Powers the in-feed "expand" on a workout card — same data the public
// /share/[postId] page shows, just fetched on demand instead of always
// paying for it in the feed's initial load. Authenticated + a normal
// group-member RLS read (not the anon path /share uses), so this only
// ever returns something for someone who could already see the post.
export async function GET(_request: Request, props: { params: Promise<{ postId: string }> }) {
  const params = await props.params;
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const shared = await getSharedWorkout(params.postId);
  if (!shared) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(shared);
}
