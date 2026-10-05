import { NextResponse } from "next/server";
import { authorizeCoachCall, isResponse, athleteIsInGroup } from "@/lib/series-route";

// Put a client on hold (comped, on a break, pays another way) or take them off. A held client is left out of the "needs
// payment" count and never reminded or alerted about.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const call = await authorizeCoachCall(body?.groupId);
  if (isResponse(call)) return call;
  const athleteId = typeof body?.athleteId === "string" ? body.athleteId : null;
  const groupId = body.groupId as string;
  if (!athleteId || typeof body?.hold !== "boolean" || !(await athleteIsInGroup(call.db, athleteId, groupId))) {
    return NextResponse.json({ error: "That client is not in this group." }, { status: 400 });
  }

  const { data: existing } = await call.db.from("session_credits").select("balance").eq("athlete_id", athleteId).eq("group_id", groupId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "This client has no sessions set up yet, so there is nothing to hold." }, { status: 422 });

  const { error } = await call.db
    .from("session_credits")
    .update({ payment_hold: body.hold })
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId);
  if (error) {
    const missing = /column|schema cache/i.test(error.message);
    return NextResponse.json({ error: missing ? "Holds are not switched on yet. Try again later." : "That did not save." }, { status: missing ? 503 : 500 });
  }
  return NextResponse.json({ ok: true, hold: body.hold });
}
