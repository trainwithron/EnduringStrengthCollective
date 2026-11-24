import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { goalSheetActor } from "@/lib/goal-sheet-server";
import { sendPushToProfile } from "@/lib/send-push";
import { cleanMainGoal, goalsPagePath, goalsSentNotice, mainGoalColumns, sameMainGoal } from "@/lib/goals-all-in-one";

// A coach sends a client their goals to fill in (Ron, Nov 23: goals, all in one): the main goal, the smaller goals and the goal sheet, on one page. Coaches only.
// The body is { groupId, athleteId, suggestion?, remind? }.
//  * suggestion: a main goal the coach suggests first, through the coach-suggests path the database already has (step 0284: the caller's own client, a proposed goal the client
//    confirms or changes). Left out when a goal is already waiting on someone, or it is the goal they already agreed.
//  * remind: only the notice again; the sheet keeps the date it was sent.
// ONE notice (bell + push) either way: when the suggestion made the database's own "Your coach suggested a goal" notice, that notice becomes this one.
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
  const fail = () => NextResponse.json({ error: "Couldn't send it. Try again." }, { status: 500 });
  const since = new Date(Date.now() - 5000).toISOString();
  const remind = body.remind === true;

  let suggested = false;
  if (!remind) {
    const suggestion = cleanMainGoal(body.suggestion);
    if (suggestion) {
      const { data: latest, error: readError } = await supabase
        .from("client_goals")
        .select("goal_type, custom_label, target_date, event_type, event_priority, weight_class_flag, status")
        .eq("athlete_id", athleteId)
        .eq("group_id", groupId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (readError) return fail();
      const waiting = latest?.status === "proposed";
      const alreadyAgreed = latest?.status === "confirmed" && sameMainGoal(suggestion, latest);
      if (!waiting && !alreadyAgreed) {
        const { error } = await supabase.from("client_goals").insert({ athlete_id: athleteId, group_id: groupId, ...mainGoalColumns(suggestion), created_by: user.id });
        if (error) return fail();
        suggested = true;
      }
    }
    const { error } = await db
      .from("client_goal_sheets")
      .upsert({ athlete_id: athleteId, group_id: groupId, requested_by: user.id, requested_at: new Date().toISOString() }, { onConflict: "athlete_id,group_id" });
    if (error) return fail();
  }

  // The one notice, straight to the one page, open for writing (audit C12, Nov 21).
  const { data: me } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  const notice = goalsSentNotice(((me?.full_name as string | null) ?? "").trim().split(/\s+/)[0]);
  const path = goalsPagePath(groupId);
  const text = `${notice.title}: ${notice.body}`;
  const { data: madeNow } = suggested
    ? await db.from("notifications").select("id").eq("profile_id", athleteId).eq("group_id", groupId).eq("type", "goal_proposed").gte("created_at", since).order("created_at", { ascending: false }).limit(1)
    : { data: [] as { id: string }[] };
  const row = ((madeNow ?? []) as { id: string }[])[0];
  if (row) await db.from("notifications").update({ body: text, link_path: path }).eq("id", row.id);
  else await db.from("notifications").insert({ profile_id: athleteId, group_id: groupId, type: "goal_proposed", body: text, link_path: path });
  await sendPushToProfile(db, athleteId, notice.title, notice.body, path).catch(() => 0);
  return NextResponse.json({ ok: true, suggested });
}
