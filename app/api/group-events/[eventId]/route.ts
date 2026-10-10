import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { sendPushToProfile } from "@/lib/send-push";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { friendlyEventError } from "@/lib/group-events";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// In, Out, cancel or mark attendance for one group event. Every one is a database function that checks who is asking and never touches a session credit.
// This route only calls it as the signed-in person, then tells anyone who was moved in off the waiting list or let down by a cancel.
export async function POST(request: Request, props: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await props.params;
  if (!UUID.test(eventId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("group-event-act", user.id, 240, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const athleteId = typeof body.athleteId === "string" && UUID.test(body.athleteId) ? body.athleteId : user.id;

  const fail = (message: string, status = 422) => {
    const notReady = /function .* does not exist|schema cache/i.test(message);
    return NextResponse.json({ error: notReady ? "Group events aren't switched on yet." : friendlyEventError(message) }, { status: notReady ? 503 : status });
  };

  // The event's title and time in the coach's zone, and which group's feed it is in, for a push.
  async function describe(): Promise<{ title: string; when: string; groupId: string | null } | null> {
    const db = createServiceRoleClient();
    const { data } = await db.from("group_sessions").select("title, start_at, coach_id, group_id").eq("id", eventId).maybeSingle();
    if (!data) return null;
    const { data: coach } = await db.from("profiles").select("timezone").eq("id", data.coach_id).maybeSingle();
    return { title: data.title, when: formatInTimezone(new Date(data.start_at), coach?.timezone ?? DEFAULT_COACH_TIMEZONE, "dateTime"), groupId: data.group_id };
  }
  async function tell(ids: string[], title: string, text: (d: { title: string; when: string }) => string) {
    if (ids.length === 0) return;
    try {
      const d = await describe();
      if (!d) return;
      const db = createServiceRoleClient();
      for (const id of ids) await sendPushToProfile(db, id, title, text(d), d.groupId ? `/groups/${d.groupId}/feed?channel=announcements` : "/").catch(() => 0);
    } catch {
      // Quiet.
    }
  }

  switch (body.action) {
    case "in": {
      const { data, error } = await supabase.rpc("join_group_event", { p_session_id: eventId, p_athlete_id: athleteId });
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true, status: data });
    }
    case "out": {
      const { data, error } = await supabase.rpc("leave_group_event", { p_session_id: eventId, p_athlete_id: athleteId });
      if (error) return fail(error.message);
      await tell((data ?? []) as string[], "You're in", (d) => `A spot opened up: ${d.title}, ${d.when}.`);
      return NextResponse.json({ ok: true });
    }
    case "cancel": {
      const { data, error } = await supabase.rpc("cancel_group_event", { p_session_id: eventId });
      if (error) return fail(error.message);
      await tell((data ?? []) as string[], "Event cancelled", (d) => `${d.title} on ${d.when} was cancelled.`);
      return NextResponse.json({ ok: true });
    }
    case "attended": {
      const { error } = await supabase.rpc("mark_group_event_attendee", { p_session_id: eventId, p_athlete_id: athleteId, p_attended: body.attended !== false });
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
