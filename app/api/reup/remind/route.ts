import { NextResponse } from "next/server";
import { authorizeCoachCall, isResponse, athleteIsInGroup } from "@/lib/series-route";
import { sendPushToProfile } from "@/lib/send-push";
import { needsPayment, reminderAllowed } from "@/lib/reup";

// The coach's one-tap "remind them to re-up". Sends the client a push (neutral wording, never "you owe"), at most once every
// 3 days, only to someone who is at zero or below and not on hold, and only if the coach has not turned reminders off.
// The cooldown is only started when the push actually reached a device, so a client with notifications off can be messaged
// another way and tried again.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const call = await authorizeCoachCall(body?.groupId);
  if (isResponse(call)) return call;
  const athleteId = typeof body?.athleteId === "string" ? body.athleteId : null;
  const groupId = body.groupId as string;
  if (!athleteId || !(await athleteIsInGroup(call.db, athleteId, groupId))) {
    return NextResponse.json({ error: "That client is not in this group." }, { status: 400 });
  }

  // Coach-wide switch (migration 0260). Missing column or row means on.
  const policy = await call.db.from("coach_booking_policies").select("reup_nudges_enabled").eq("coach_id", call.userId).maybeSingle();
  if (!policy.error && policy.data && policy.data.reup_nudges_enabled === false) {
    return NextResponse.json({ error: "Re-up reminders are turned off in your booking settings." }, { status: 422 });
  }

  let credits: { balance: number; payment_hold?: boolean | null; last_reup_nudge_at?: string | null } | null = null;
  const first = await call.db
    .from("session_credits")
    .select("balance, payment_hold, last_reup_nudge_at")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (first.error) {
    const legacy = await call.db.from("session_credits").select("balance").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle();
    credits = legacy.data;
  } else {
    credits = first.data;
  }

  if (!credits || !needsPayment(credits.balance, credits.payment_hold)) {
    return NextResponse.json({ error: "That client does not need to re-up right now." }, { status: 422 });
  }
  if (!reminderAllowed(credits.last_reup_nudge_at, new Date())) {
    return NextResponse.json({ error: "They were reminded in the last 3 days." }, { status: 422 });
  }

  const { data: coach } = await call.db.from("profiles").select("full_name").eq("id", call.userId).maybeSingle();
  const sent = await sendPushToProfile(
    call.db,
    athleteId,
    "Time to re-up",
    `${coach?.full_name ?? "Your coach"}: your sessions are all used. Tap to add more.`,
    `/groups/${groupId}`
  ).catch(() => 0);

  if (!sent) {
    return NextResponse.json({ error: "They don't have notifications turned on. Send them a message instead." }, { status: 422 });
  }
  await call.db
    .from("session_credits")
    .update({ last_reup_nudge_at: new Date().toISOString() })
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId);
  return NextResponse.json({ ok: true, message: "Reminder sent." });
}
