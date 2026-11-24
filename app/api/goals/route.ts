import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { cleanGoalSheet, goalSheetHasAnswers, goalSheetWaitingOnClient } from "@/lib/goal-sheet";
import { goalSheetActor } from "@/lib/goal-sheet-server";
import { cleanMainGoal, cleanNewSubGoals, goalLabel, goalsFilledNotice, mainGoalColumns, sameMainGoal } from "@/lib/goals-all-in-one";
import { sendCoachPush } from "@/lib/coach-notice";
import { sendPushToProfile } from "@/lib/send-push";

// One save of "Your goals" (Ron, Nov 23: goals, all in one): the main goal, new smaller goals and the goal sheet, from the client for themselves or from a coach of the group
// filling it in with them. The body is { groupId, athleteId, goal, subGoals, answers }.
//  * The main goal and the smaller goals are written with the caller's own client, so the database's rules decide exactly as before (step 0284: a client's goal is proposed and
//    the coach confirms; a goal the coach suggested is the client's to confirm, and keeping it as it is confirms it, changing it sends it back; a coach's goal is a suggestion).
//  * The goal sheet is written by the server, as /api/goal-sheet does (signed-in people cannot write that table).
//  * The coach who sent the goals gets ONE notice (bell + push) when the client fills them in (at least one sheet answer): the database's own notice about the goal, if it made
//    one just now, says so too. A goal alone tells the coaches about the goal.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("goals-save", user.id, 60, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const db = createServiceRoleClient();
  const actor = await goalSheetActor(supabase, db, user.id, body.groupId, body.athleteId);
  if (!actor) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const groupId = body.groupId as string;
  const athleteId = body.athleteId as string;
  const fail = () => NextResponse.json({ error: "Couldn't save your goals. Try again." }, { status: 500 });

  // ---- 1. the main goal ----
  const goal = cleanMainGoal(body.goal);
  let goalMoved: "confirmed" | "changed" | "proposed" | null = null;
  if (goal) {
    const { data: current, error: readError } = await supabase
      .from("client_goals")
      .select("id, goal_type, custom_label, target_date, event_type, event_priority, weight_class_flag, status, created_by")
      .eq("athlete_id", athleteId)
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (readError) return fail();
    const same = sameMainGoal(goal, current);
    if (current?.status === "proposed" && current.created_by !== user.id) {
      // Waiting on the caller. Kept as it is: the client confirms it (a coach confirms a client's goal only with the Confirm button). Changed: it goes back to the other side.
      if (!same) {
        const { error } = await supabase.from("client_goals").update(mainGoalColumns(goal)).eq("id", current.id);
        if (error) return fail();
        goalMoved = "changed";
      } else if (actor.role === "client") {
        const { error } = await supabase.from("client_goals").update({ status: "confirmed" }).eq("id", current.id);
        if (error) return fail();
        goalMoved = "confirmed";
      }
    } else if (!same || current?.status === "declined") {
      const { error } = await supabase.from("client_goals").insert({ athlete_id: athleteId, group_id: groupId, ...mainGoalColumns(goal), created_by: user.id });
      if (error) return fail();
      goalMoved = "proposed";
    }
  }

  // ---- 2. new smaller goals ----
  const { data: existingSubs } = await db.from("client_sub_goals").select("title").eq("athlete_id", athleteId).eq("group_id", groupId);
  const titles = cleanNewSubGoals(body.subGoals, ((existingSubs ?? []) as { title: string }[]).map((s) => s.title));
  if (titles.length > 0) {
    const { error } = await supabase.from("client_sub_goals").insert(titles.map((title) => ({ athlete_id: athleteId, group_id: groupId, title, proposed_by: user.id })));
    if (error) return fail();
  }

  // ---- 3. the goal sheet: saved, and marked filled in, only with at least one answer (a client who sends only a main goal has not filled in their goals) ----
  const answers = cleanGoalSheet(body.answers);
  const { data: before } = await db.from("client_goal_sheets").select("requested_by, requested_at, filled_at").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle();
  const sheetFilled = goalSheetHasAnswers(answers);
  if (sheetFilled) {
    const { error } = await db
      .from("client_goal_sheets")
      .upsert({ athlete_id: athleteId, group_id: groupId, ...answers, filled_by: user.id, filled_at: new Date().toISOString() }, { onConflict: "athlete_id,group_id" });
    if (error) return fail();
  }

  // ---- 4. who is told ----
  const coachPath = `/groups/${groupId}/athletes/${athleteId}`;
  if (actor.role === "client") {
    const { data: me } = await db.from("profiles").select("full_name").eq("id", athleteId).maybeSingle();
    const name = ((me?.full_name as string | null) ?? "").trim() || "Your client";
    if (sheetFilled && before?.requested_by && goalSheetWaitingOnClient(before)) {
      // The coach who sent the goals: one notice. The database's notice about the goal (made just now, if the goal moved) becomes that one notice.
      const coachId = before.requested_by as string;
      const filled = goalsFilledNotice(name);
      // Only a notice THIS save made is rewritten: the database makes one when the client confirms or changes the goal (step 0284). Anything older (say the bell for a goal sent
      // alone earlier, already read) stays as it is, and this one is a new bell (review of cf892bc5).
      const dbMadeOne = goalMoved === "confirmed" || goalMoved === "changed";
      const { data: madeNow } = dbMadeOne
        ? await db
            .from("notifications")
            .select("id, body")
            .eq("profile_id", coachId)
            .eq("group_id", groupId)
            .eq("type", "goal_answered")
            // since the coach sent the goals (the database's own time, never the server's clock): the database's notice made by this save is the newest one
            .gte("created_at", before.requested_at as string)
            .order("created_at", { ascending: false })
            .limit(1)
        : { data: [] as { id: string; body: string | null }[] };
      const row = ((madeNow ?? []) as { id: string; body: string | null }[])[0];
      // a goal the client set new in this save is in the same notice (the database makes none for it)
      const newGoal = goalMoved === "proposed" && goal ? ` ${name} set a goal: ${goalLabel(goal.goalType, goal.customLabel)}` : "";
      if (row) await db.from("notifications").update({ body: `${filled} ${row.body ?? ""}`.trim(), link_path: coachPath }).eq("id", row.id);
      else await db.from("notifications").insert({ profile_id: coachId, group_id: groupId, type: "goal_answered", body: `${filled}${newGoal}`, link_path: coachPath });
      await sendCoachPush(db, coachId, "client_activity", `${name} filled in their goals`, "Open their page to read them.", coachPath).catch(() => 0);
    } else if (goalMoved && goal) {
      // The goal alone. The database puts a goal the client confirms or changes on the coaches' bells itself (step 0284); a goal the client sets new it does not, so that bell
      // is made here. Each coach's phone hears it too (as the goal page did).
      const { data: coaches } = await db.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "coach");
      const label = goalLabel(goal.goalType, goal.customLabel);
      const what = goalMoved === "confirmed" ? `${name} confirmed the goal` : goalMoved === "changed" ? `${name} suggested a change to the goal` : `${name} set a goal`;
      for (const c of (coaches ?? []) as { profile_id: string }[]) {
        if (c.profile_id === user.id) continue;
        if (goalMoved === "proposed") await db.from("notifications").insert({ profile_id: c.profile_id, group_id: groupId, type: "goal_answered", body: `${what}: ${label}`, link_path: coachPath });
        await sendCoachPush(db, c.profile_id, "client_activity", what, label, coachPath).catch(() => 0);
      }
    }
  } else if (goalMoved && goal) {
    // A coach's goal is a suggestion: the database put it on the client's bell; their phone hears it too.
    await sendPushToProfile(db, athleteId, "Your coach suggested a goal", "Open your goals to confirm it, change it, or say not now.", `/groups/${groupId}/goal`).catch(() => 0);
  }
  return NextResponse.json({ ok: true });
}
