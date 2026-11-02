import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { goalSheetActor } from "@/lib/goal-sheet-server";
import { sendPushToProfile } from "@/lib/send-push";

// A coach sends a client their goal sheet to fill in: the client is told (bell + push) and their goal page asks them to fill it in. Coaches only.
// The body is { groupId, athleteId }.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("goal-sheet-send", user.id, 30, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const db = createServiceRoleClient();
  const actor = await goalSheetActor(supabase, db, user.id, body.groupId, body.athleteId);
  if (actor?.role !== "coach") return NextResponse.json({ error: "Not found." }, { status: 404 });
  const groupId = body.groupId as string;
  const athleteId = body.athleteId as string;

  const { error } = await db
    .from("client_goal_sheets")
    .upsert({ athlete_id: athleteId, group_id: groupId, requested_by: user.id, requested_at: new Date().toISOString() }, { onConflict: "athlete_id,group_id" });
  if (error) return NextResponse.json({ error: "Couldn't send it. Try again." }, { status: 500 });

  const path = `/groups/${groupId}/goal`;
  await db.from("notifications").insert({ profile_id: athleteId, group_id: groupId, type: "goal_proposed", body: "Your coach sent you a goal sheet to fill in.", link_path: path });
  await sendPushToProfile(db, athleteId, "Your coach sent you a goal sheet", "Open My Goal to fill it in.", path).catch(() => 0);
  return NextResponse.json({ ok: true });
}
