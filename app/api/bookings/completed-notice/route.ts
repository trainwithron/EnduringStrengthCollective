import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { sendPushToProfile } from "@/lib/send-push";
import { nowInZone } from "@/lib/timezone";
import { readPushPrefs } from "@/lib/push-prefs";
import { completedSessionPush, clientMayBePushedAt } from "@/lib/completed-session-push";

// After the COACH marks a session attended, the client (only if they use the app and allow push) gets ONE push about that one session: "Good job completing your session with <Coach first name> today. You have N sessions
// left." Only the coach of the session's group can ask for it, only for a session that really is marked attended. It is sent between 7:00 and 20:59 in the client's own
// time; outside that it is not sent. The client never marks anything.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const limited = await rateLimitResponse("completed-notice", user.id, 120, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : null;
  if (!bookingId) return NextResponse.json({ error: "Missing session." }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: booking } = await db.from("bookings").select("id, coach_id, athlete_id, group_id, attended_at, status").eq("id", bookingId).maybeSingle();
  const b = booking as { id: string; coach_id: string; athlete_id: string; group_id: string; attended_at: string | null; status: string } | null;
  if (!b) return NextResponse.json({ sent: 0 });
  // Only the coach of that session's group (the session's own coach).
  const { data: seat } = await db.from("group_memberships").select("role").eq("group_id", b.group_id).eq("profile_id", user.id).maybeSingle();
  if ((seat as { role?: string } | null)?.role !== "coach") return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (b.status !== "confirmed" || !b.attended_at) return NextResponse.json({ sent: 0 });
  // Marked attended a long time ago (an undo and a redo, an old catch-up) is not news.
  if (Date.now() - new Date(b.attended_at).getTime() > 6 * 3600000) return NextResponse.json({ sent: 0 });
  if (b.athlete_id === user.id) return NextResponse.json({ sent: 0 });

  const [{ data: coach }, { data: credits }, prefs] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", b.coach_id).maybeSingle(),
    db.from("session_credits").select("balance").eq("athlete_id", b.athlete_id).eq("group_id", b.group_id).maybeSingle(),
    readPushPrefs(db, b.athlete_id),
  ]);
  if (!clientMayBePushedAt(nowInZone(prefs.timeZone).getUTCHours())) return NextResponse.json({ sent: 0, reason: "outside_hours" });

  const push = completedSessionPush((coach as { full_name?: string | null } | null)?.full_name ?? null, (credits as { balance?: number | null } | null)?.balance ?? null);
  const sent = await sendPushToProfile(db, b.athlete_id, push.title, push.body, `/groups/${b.group_id}/calendar`).catch(() => 0);
  return NextResponse.json({ sent });
}
