import { NextResponse } from "next/server";
import { createSeries } from "@/lib/series-engine";
import { athleteIsInGroup, authorizeCoachCall, isResponse, parseSeriesInput } from "@/lib/series-route";
import { sendPushToProfile } from "@/lib/send-push";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

// Creates a recurring schedule for a client: books every week (fixed) or the next 12 weeks (ongoing). Each booking goes
// through book_session, so overlap and buffer rules are the same as booking one session. The client gets one message, not
// one per week.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const call = await authorizeCoachCall(body?.groupId);
  if (isResponse(call)) return call;

  const input = parseSeriesInput(body, call.userId);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!(await athleteIsInGroup(call.db, input.athleteId, input.groupId))) {
    return NextResponse.json({ error: "That client is not in this group." }, { status: 400 });
  }

  const result = await createSeries(call.store, input);
  if (!result.ok) return NextResponse.json({ error: result.error ?? "Could not create the schedule.", notBooked: result.notBooked }, { status: 422 });

  // One quiet heads-up to the client, in the coach's time zone. Best effort.
  try {
    const { data: coach } = await call.db.from("profiles").select("full_name, timezone").eq("id", call.userId).maybeSingle();
    const tz = coach?.timezone ?? DEFAULT_COACH_TIMEZONE;
    const when = formatInTimezone(new Date(input.firstStartIso), tz, "dateTime");
    await sendPushToProfile(
      call.db,
      input.athleteId,
      "Sessions scheduled",
      `${coach?.full_name ?? "Your coach"} booked ${result.booked} weekly ${result.booked === 1 ? "session" : "sessions"}, starting ${when}.`,
      `/groups/${input.groupId}/calendar`
    );
  } catch {
    // Never blocks the schedule.
  }

  return NextResponse.json({ ok: true, seriesId: result.seriesId, booked: result.booked, notBooked: result.notBooked });
}
