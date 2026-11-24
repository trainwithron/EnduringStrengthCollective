import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { sendCoachPush } from "@/lib/coach-notice";
import { answeredNotice, answeredSummary, checkinIsOpen, cleanCheckinAnswer, coachCheckinPath } from "@/lib/food-checkin";

// The client answers their coach's food check-in (Nov 24): the chips they ticked and their own words. Only their own, and only while it is open (sent, unanswered, under 7 days).
// The coach it was sent as gets ONE notice: a bell (food_checkin_answered: the coach's "Client activity" switch applies in the database) and a push (the same switch, lib/coach-notice.ts).
// The body is { id, reasons, note }.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("food-checkin-answer", user.id, 30, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  const answer = cleanCheckinAnswer(body);
  if (!id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!answer) return NextResponse.json({ error: "Tick at least one, or write a line." }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: row } = await db.from("client_food_checkins").select("id, athlete_id, group_id, coach_id, status, sent_at").eq("id", id).maybeSingle();
  if (!row || row.athlete_id !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!checkinIsOpen(row as { status: string; sent_at: string }, new Date())) return NextResponse.json({ ok: true, already: true });

  // Only the first answer lands (a second tap, or two devices, changes nothing and tells nobody twice).
  const { data: changed, error } = await db
    .from("client_food_checkins")
    .update({ status: "answered", reasons: answer.reasons, note: answer.note, answered_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "sent")
    .select("id");
  if (error) return NextResponse.json({ error: "That didn't send. Try again." }, { status: 500 });
  if (!changed || changed.length === 0) return NextResponse.json({ ok: true, already: true });

  const groupId = row.group_id as string;
  const coachId = row.coach_id as string | null;
  if (coachId) {
    const { data: me } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    const name = ((me?.full_name as string | null) ?? "").trim() || null;
    const path = coachCheckinPath(groupId, user.id);
    await db.from("notifications").insert({ profile_id: coachId, group_id: groupId, type: "food_checkin_answered", body: answeredNotice(answer, name), link_path: path });
    await sendCoachPush(db, coachId, "client_activity", `${name ?? "Your client"} answered your food check-in`, `${answeredSummary(answer)[0].toUpperCase()}${answeredSummary(answer).slice(1)}.`, path).catch(() => 0);
  }
  return NextResponse.json({ ok: true });
}
