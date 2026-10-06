import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { gatherProgressLook } from "@/lib/progress-look-gather";

// The "time to progress?" row on a coach's Home: the clients whose main lifts have sat at the same load and reps for a while, read with the coach's own access
// (so only their own clients), and only for a coach. A client can never call this for anyone: it returns nothing unless the caller coaches at least one group.
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data: coached } = await supabase.from("group_memberships").select("group_id").eq("profile_id", user.id).eq("role", "coach");
  const groupIds = ((coached ?? []) as { group_id: string }[]).map((r) => r.group_id);
  if (groupIds.length === 0) return NextResponse.json({ cards: [], threshold: 3, hintOn: true, truncated: false });

  try {
    const data = await gatherProgressLook(supabase, { coachId: user.id, groupIds, now: new Date() });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // Never break Home for a suggestion: show nothing.
    return NextResponse.json({ cards: [], threshold: 3, hintOn: true, truncated: false });
  }
}
