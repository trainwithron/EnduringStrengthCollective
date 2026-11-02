import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { cleanGoalSheet, goalSheetWaitingOnClient } from "@/lib/goal-sheet";
import { goalSheetActor } from "@/lib/goal-sheet-server";
import { sendCoachPush } from "@/lib/coach-notice";

// Save one client's goal sheet: the client for themselves, or a coach of the group filling it in with them. Signed-in people cannot write the table
// themselves (step 197); this route checks who is asking. When the client fills in a sheet their coach sent, that coach is told (bell + push).
// The body is { groupId, athleteId, answers }.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("goal-sheet-save", user.id, 60, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const db = createServiceRoleClient();
  const actor = await goalSheetActor(supabase, db, user.id, body.groupId, body.athleteId);
  if (!actor) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const groupId = body.groupId as string;
  const athleteId = body.athleteId as string;

  const { data: before } = await db.from("client_goal_sheets").select("requested_by, requested_at, filled_at").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle();
  const { error } = await db
    .from("client_goal_sheets")
    .upsert({ athlete_id: athleteId, group_id: groupId, ...cleanGoalSheet(body.answers), filled_by: user.id, filled_at: new Date().toISOString() }, { onConflict: "athlete_id,group_id" });
  if (error) return NextResponse.json({ error: "Couldn't save the goal sheet. Try again." }, { status: 500 });

  if (actor.role === "client" && before?.requested_by && goalSheetWaitingOnClient(before)) {
    const { data: me } = await db.from("profiles").select("full_name").eq("id", athleteId).maybeSingle();
    const name = ((me?.full_name as string | null) ?? "").trim() || "Your client";
    const path = `/groups/${groupId}/athletes/${athleteId}`;
    await db.from("notifications").insert({ profile_id: before.requested_by, group_id: groupId, type: "goal_answered", body: `${name} filled in their goal sheet.`, link_path: path });
    await sendCoachPush(db, before.requested_by as string, "client_activity", `${name} filled in their goal sheet`, "Open their page to read it.", path).catch(() => 0);
  }
  return NextResponse.json({ ok: true });
}
