import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { rateLimitResponse } from "@/lib/rate-limit";
import { createProblem, friendlyGroupSessionError } from "@/lib/group-sessions";

// A coach schedules a small-group session with a number of spots. The database does the real checks (coach of the group, the time
// is free, a valid capacity) and keeps the time blocked in the coach's calendar.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("group-session-create", user.id, 60, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const input = {
    title: typeof body.title === "string" ? body.title : "",
    startIso: typeof body.startIso === "string" ? body.startIso : "",
    durationMinutes: Number(body.durationMinutes),
    capacity: Number(body.capacity),
    locationNote: typeof body.locationNote === "string" ? body.locationNote : "",
  };
  if (!groupId) return NextResponse.json({ error: "Missing group." }, { status: 400 });
  const problem = createProblem(input, new Date());
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const start = new Date(input.startIso);
  const end = new Date(start.getTime() + input.durationMinutes * 60000);
  const { data, error } = await supabase.rpc("create_group_session", {
    p_group_id: groupId,
    p_title: input.title.trim(),
    p_start_at: start.toISOString(),
    p_end_at: end.toISOString(),
    p_capacity: input.capacity,
    p_session_type_id: typeof body.sessionTypeId === "string" && body.sessionTypeId ? body.sessionTypeId : null,
    p_location_note: input.locationNote.trim() || null,
  });
  if (error) {
    const notReady = /function .* does not exist|schema cache/i.test(error.message);
    return NextResponse.json({ error: notReady ? "Group sessions aren't switched on yet." : friendlyGroupSessionError(error.message) }, { status: notReady ? 503 : 422 });
  }
  return NextResponse.json({ ok: true, id: data });
}
