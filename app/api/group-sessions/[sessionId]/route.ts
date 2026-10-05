import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { friendlyGroupSessionError } from "@/lib/group-sessions";
import { notifyCancelled, notifyPromoted } from "@/lib/group-session-notify";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Join, leave, add, remove, change spots, cancel or mark attendance for one class. Every one is a database function that checks who
// is asking (the client for themselves, or the coach), locks the class while it counts spots, and moves charges. This route only
// calls it as the signed-in person and then tells anyone who was moved in or let down.
export async function POST(request: Request, props: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await props.params;
  if (!UUID.test(sessionId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("group-session-act", user.id, 120, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  // Who the action is about: themselves unless a coach names a client.
  const athleteId = typeof body.athleteId === "string" && UUID.test(body.athleteId) ? body.athleteId : user.id;
  const db = createServiceRoleClient();

  async function fail(message: string, status = 422) {
    const notReady = /function .* does not exist|schema cache/i.test(message);
    return NextResponse.json({ error: notReady ? "Group sessions aren't switched on yet." : friendlyGroupSessionError(message) }, { status: notReady ? 503 : status });
  }

  switch (body.action) {
    case "join": {
      const { data, error } = await supabase.rpc("join_group_session", { p_session_id: sessionId, p_athlete_id: athleteId });
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true, status: data });
    }
    case "leave": {
      const { data, error } = await supabase.rpc("leave_group_session", { p_session_id: sessionId, p_athlete_id: athleteId });
      if (error) return fail(error.message);
      await notifyPromoted(db, sessionId, (data ?? []) as string[]);
      return NextResponse.json({ ok: true });
    }
    case "capacity": {
      const { data, error } = await supabase.rpc("set_group_session_capacity", { p_session_id: sessionId, p_capacity: Number(body.capacity) });
      if (error) return fail(error.message);
      await notifyPromoted(db, sessionId, (data ?? []) as string[]);
      return NextResponse.json({ ok: true });
    }
    case "cancel": {
      const { data, error } = await supabase.rpc("cancel_group_session", { p_session_id: sessionId });
      if (error) return fail(error.message);
      await notifyCancelled(db, sessionId, (data ?? []) as string[]);
      return NextResponse.json({ ok: true });
    }
    case "attended": {
      const { error } = await supabase.rpc("mark_group_attendee", { p_session_id: sessionId, p_athlete_id: athleteId, p_attended: body.attended !== false });
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
