import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { gatherProgressLook } from "@/lib/progress-look-gather";
import { getActiveAnchor } from "@/lib/active-anchor";

// The "time to progress?" row on a coach's Home: the clients whose main lifts have sat at the same load and reps for a while, read with the coach's own access
// (so only their own clients), and only for a coach. A client can never call this for anyone: it returns nothing unless the caller coaches at least one group.
export async function GET() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  // Only the groups of the organization the coach has open: another organization's client names never go over the wire, and its clients cannot use up the three cards.
  const active = await getActiveAnchor(supabase, user.id);
  const groupIds = active && !active.needsChoice ? active.groups.filter((g) => g.orgId === active.orgId).map((g) => g.id) : [];
  if (groupIds.length === 0) return NextResponse.json({ cards: [], threshold: 3, hintOn: true, truncated: false });

  try {
    const data = await gatherProgressLook(supabase, { coachId: user.id, groupIds, now: new Date() });
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // Never break Home for a suggestion: show nothing.
    return NextResponse.json({ cards: [], threshold: 3, hintOn: true, truncated: false });
  }
}
