import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { canShareWorkouts, loadSharedGroupOffer, removeSharedWorkoutCards, sharingColumnReady } from "@/lib/shared-group-join";

// A client joining, sharing with, or leaving their organization's shared group (Ron, Nov 9). Signed-in people cannot add themselves to a group or change the sharing choice directly, so this route
// checks everything on the server and then writes with the service role. It only ever acts on the signed-in person's own seat, only as a social-only athlete, and only in the group they are offered.
// Body: { action: "join", spaceGroupId, share } | { action: "share", groupId, share } | { action: "leave", groupId }.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("shared-group", user.id, 30, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as { action?: unknown; spaceGroupId?: unknown; groupId?: unknown; share?: unknown };
  const share = body.share === true;
  const db = createServiceRoleClient();
  if (!(await sharingColumnReady(db))) return NextResponse.json({ error: "Joining isn't available yet." }, { status: 409 });

  if (body.action === "join") {
    if (typeof body.spaceGroupId !== "string") return NextResponse.json({ error: "Not found." }, { status: 404 });
    const offer = await loadSharedGroupOffer(db, user.id, body.spaceGroupId);
    if (!offer) return NextResponse.json({ error: "This group isn't available to join." }, { status: 404 });
    if (share && !offer.allowShare) return NextResponse.json({ error: "Your workouts stay private in the group." }, { status: 403 });
    const { error } = await db.from("group_memberships").insert({ group_id: offer.groupId, profile_id: user.id, role: "athlete", membership_type: "social_only", shares_workouts: share });
    // already in (a second tap): fine
    if (error && error.code !== "23505") return NextResponse.json({ error: "Couldn't join. Try again." }, { status: 500 });
    return NextResponse.json({ ok: true, groupId: offer.groupId });
  }

  if (body.action === "share" || body.action === "leave") {
    if (typeof body.groupId !== "string") return NextResponse.json({ error: "Not found." }, { status: 404 });
    const groupId = body.groupId;
    // Only a social-only seat: the group the client actually trains in is never changed or left from here.
    const { data: seat } = await db.from("group_memberships").select("id").eq("group_id", groupId).eq("profile_id", user.id).eq("role", "athlete").eq("membership_type", "social_only").maybeSingle();
    if (!seat) return NextResponse.json({ error: "Not found." }, { status: 404 });

    if (body.action === "share") {
      if (share) {
        const { data: intake, error: intakeError } = await db.from("client_intake").select("date_of_birth").eq("athlete_id", user.id).maybeSingle();
        if (intakeError || !canShareWorkouts((intake as { date_of_birth?: string | null } | null)?.date_of_birth)) {
          return NextResponse.json({ error: "Your workouts stay private in the group." }, { status: 403 });
        }
      }
      const { error } = await db.from("group_memberships").update({ shares_workouts: share }).eq("id", seat.id);
      if (error) return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
      // Off: the cards already posted there come off the group's feed (and so off its leaderboard).
      if (!share && !(await removeSharedWorkoutCards(db, groupId, user.id))) {
        return NextResponse.json({ error: "Saved, but some of your earlier workout cards are still on the group's feed. Try again." }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    // Leave: the workout cards from their own space come off the group's feed first, then the seat goes.
    if (!(await removeSharedWorkoutCards(db, groupId, user.id))) return NextResponse.json({ error: "Couldn't leave. Try again." }, { status: 500 });
    const { error } = await db.from("group_memberships").delete().eq("id", seat.id);
    if (error) return NextResponse.json({ error: "Couldn't leave. Try again." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
