import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCallerGroupRole } from "@/lib/group-access";
import { formatInTimezone, timezoneForProfiles } from "@/lib/format-in-timezone";
import { rateLimitResponse } from "@/lib/rate-limit";
import { sendPushToProfile } from "@/lib/send-push";
import { confirmationEmail, emailClientNotice } from "@/lib/client-notice-email";

// "Session confirmed", sent right after a session is booked: a phone alert to the client when they have alerts on, and otherwise the same line by EMAIL (almost no client has alerts on: Oct 19 audit). It used to
// be a browser-side push call, which cannot send email. Authorized like the text-message confirmation next to it: only the client themself or a coach of that group, only for a booking that really exists, and
// everything (names, time, time zone) is worked out here, never taken from the caller. One notice per booking: a second call for the same booking does nothing.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const athleteId = typeof body?.athleteId === "string" ? body.athleteId : null;
  const groupId = typeof body?.groupId === "string" ? body.groupId : null;
  const startAt = typeof body?.startAt === "string" ? body.startAt : null;
  if (!athleteId || !groupId || !startAt) return NextResponse.json({ error: "Missing athleteId, groupId, or startAt." }, { status: 400 });

  const role = await getCallerGroupRole(supabase, user.id, groupId);
  if (!role || (role === "athlete" && user.id !== athleteId)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const db = createServiceRoleClient();
  const { data: booking } = await db
    .from("bookings")
    .select("coach_id")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .eq("start_at", startAt)
    .eq("status", "confirmed")
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  // One notice per booking, whatever is retried.
  const limited = await rateLimitResponse("confirmed-notice", `${athleteId}:${groupId}:${startAt}`, 1, 86400);
  if (limited) return NextResponse.json({ sent: 0, email: "already_sent" });

  const coachId = (booking as { coach_id: string }).coach_id;
  const { data: coach } = await db.from("profiles").select("full_name").eq("id", coachId).maybeSingle();
  const coachName = (coach as { full_name?: string | null } | null)?.full_name ?? null;
  const tz = await timezoneForProfiles(db, [athleteId, coachId]);
  const when = formatInTimezone(startAt, tz, "dateTime");
  const first = (coachName ?? "").trim().split(/\s+/)[0] || "your coach";

  const sent = await sendPushToProfile(db, athleteId, "Session confirmed", `You're booked with ${first} for ${when}.`, `/groups/${groupId}/calendar`).catch(() => 0);
  if (sent > 0) return NextResponse.json({ sent });
  const mail = confirmationEmail({ coachName, when, groupId });
  const email = await emailClientNotice(db, athleteId, mail.subject, mail.text).catch(() => "failed" as const);
  return NextResponse.json({ sent: 0, email });
}
