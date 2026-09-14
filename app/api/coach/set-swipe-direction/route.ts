import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Lets a coach set the exercise-logging swipe-direction preference on a
// client's behalf (swipe_card_logging_and_spotter_nudge_idea.md, resolved
// 2026-09-14 — "athlete, or coach on their behalf"). profiles' only
// UPDATE policy is self-only (id = auth.uid()), and this deliberately
// doesn't widen that to a blanket coach-can-update-profiles policy — that
// would also hand a coach write access to a client's full_name/avatar_url
// through the same door. Instead: authorize narrowly here (same
// coach/athlete shared-group check is_client_of_coach() already encodes
// at the database level for other coach-wide features), then write
// through the service-role client, touching only this one column.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const athleteId = typeof body?.athleteId === "string" ? body.athleteId : null;
  const direction = body?.direction;
  if (!athleteId || (direction !== "vertical" && direction !== "horizontal")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { data: coachGroups } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", user.id)
    .eq("role", "coach");
  const groupIds = (coachGroups ?? []).map((g) => g.group_id);
  if (groupIds.length === 0) {
    return NextResponse.json({ error: "Not a coach" }, { status: 403 });
  }

  const { data: athleteMembership } = await supabase
    .from("group_memberships")
    .select("group_id")
    .eq("profile_id", athleteId)
    .eq("role", "athlete")
    .in("group_id", groupIds)
    .maybeSingle();
  if (!athleteMembership) {
    return NextResponse.json({ error: "Not your client" }, { status: 403 });
  }

  const serviceRole = createServiceRoleClient();
  const { error } = await serviceRole
    .from("profiles")
    .update({ exercise_swipe_direction: direction })
    .eq("id", athleteId);
  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
