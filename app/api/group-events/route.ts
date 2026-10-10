import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { sendPushToProfile } from "@/lib/send-push";
import { formatInTimezone } from "@/lib/format-in-timezone";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";
import { eventPostBody, eventProblem, friendlyEventError } from "@/lib/group-events";

// A coach adds a group event. The database does the real checks (coach of that group, the time is free) and keeps the time blocked on the calendar. Then the
// group hears about it ONCE: one announcement in the group's feed (with In and Out buttons) and one push per member. A failure after the event exists never undoes it.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("group-event-create", user.id, 60, 3600);
  if (limited) return limited;

  const body = await request.json().catch(() => ({}));
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const capacityNumber = Number(body.capacity);
  const input = {
    title: typeof body.title === "string" ? body.title : "",
    startIso: typeof body.startIso === "string" ? body.startIso : "",
    durationMinutes: Number(body.durationMinutes),
    place: typeof body.place === "string" ? body.place : "",
    note: typeof body.note === "string" ? body.note : "",
    capacity: body.capacity === undefined || body.capacity === null || body.capacity === "" || capacityNumber === 0 ? null : capacityNumber,
  };
  if (!groupId) return NextResponse.json({ error: "Missing group." }, { status: 400 });
  const problem = eventProblem(input, new Date());
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const start = new Date(input.startIso);
  const end = new Date(start.getTime() + input.durationMinutes * 60000);
  const { data: eventId, error } = await supabase.rpc("create_group_event", {
    p_group_id: groupId,
    p_title: input.title.trim(),
    p_start_at: start.toISOString(),
    p_end_at: end.toISOString(),
    p_place: input.place.trim() || null,
    p_note: input.note.trim() || null,
    p_capacity: input.capacity,
  });
  if (error) {
    const notReady = /function .* does not exist|schema cache/i.test(error.message);
    return NextResponse.json({ error: notReady ? "Group events aren't switched on yet." : friendlyEventError(error.message) }, { status: notReady ? 503 : 422 });
  }

  // Tell the group once. Best effort: the event already exists.
  try {
    const db = createServiceRoleClient();
    const [{ data: coach }, { data: group }, { data: members }] = await Promise.all([
      db.from("profiles").select("full_name, timezone").eq("id", user.id).maybeSingle(),
      db.from("groups").select("name").eq("id", groupId).maybeSingle(),
      db.from("group_memberships").select("profile_id").eq("group_id", groupId).eq("role", "athlete"),
    ]);
    const when = formatInTimezone(start, coach?.timezone ?? DEFAULT_COACH_TIMEZONE, "dateTime");
    const title = input.title.trim();
    const postBody = eventPostBody({ coachName: coach?.full_name ?? "Your coach", title, when, place: input.place.trim() || null });
    await db.from("posts").insert({ group_id: groupId, author_id: user.id, post_type: "user_post", channel: "announcements", body: postBody, group_session_id: eventId });
    for (const m of (members ?? []) as { profile_id: string }[]) {
      await sendPushToProfile(db, m.profile_id, group?.name ?? "Group event", postBody, `/groups/${groupId}/feed?channel=announcements`).catch(() => 0);
    }
  } catch {
    // Quiet.
  }
  return NextResponse.json({ ok: true, id: eventId });
}
