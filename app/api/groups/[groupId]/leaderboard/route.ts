import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { getGroupLeaderboardRankings, getPositionLeaderboardRankings } from "@/lib/leaderboard-data";
import { loadNameProtectedIds } from "@/lib/minor-names";
import { rateLimitResponse } from "@/lib/rate-limit";

// The live leaderboard's refresh. The rankings are made here, on the server, so the list of members who are not confirmed adults (shown as first name and last initial) is looked up fresh every time and
// never reaches the browser: a screen left open for days cannot keep an old list. Only a member of the group can ask, and the data is read under that person's own access.
export async function GET(request: Request, context: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await context.params;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });

  const limited = await rateLimitResponse("group-leaderboard", user.id, 120, 3600);
  if (limited) return limited;

  const { data: seat, error: seatError } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (seatError || !seat) return NextResponse.json({ error: "That group was not found." }, { status: 404 });

  const withPositions = new URL(request.url).searchParams.get("positions") === "1";
  const rankings = await getGroupLeaderboardRankings(supabase, groupId, loadNameProtectedIds);
  const positionGroups = withPositions ? await getPositionLeaderboardRankings(supabase, groupId, loadNameProtectedIds) : null;
  return NextResponse.json({ rankings, positionGroups });
}
