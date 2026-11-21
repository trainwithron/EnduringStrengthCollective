import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rateLimitResponse } from "@/lib/rate-limit";
import { sendCoachPush } from "@/lib/coach-notice";
import { cleanCheckin, coachNotice, COACH_CHECKINS_PATH } from "@/lib/weekly-checkin";
import { checkinCoach, checkinTimezone, currentCheckinWeek, isMissingSchema, loadCheckinSnapshot, loadOwnCheckin } from "@/lib/weekly-checkin-server";

// A client sends (or changes) their weekly check-in (Ron, Nov 20: R2). Written with the client's own session, so row security decides: only their own, only in a space where they are
// a client, only while their coach has not reviewed it (migration 0459). The card's numbers are worked out here from their logs, never taken from the browser. The first send of the
// week tells the coach (the bell, and a push unless they switched Client activity off); a change to it does not tell them again.
// The body is { groupId, energy, eating, win, hard, photoIds }.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = await rateLimitResponse("weekly-checkin-send", user.id, 30, 3600);
  if (limited) return limited;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  if (!groupId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const cleaned = cleanCheckin(body);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const { data: membership } = await supabase.from("group_memberships").select("role").eq("group_id", groupId).eq("profile_id", user.id).maybeSingle();
  if (membership?.role !== "athlete") return NextResponse.json({ error: "Only a client sends a check-in." }, { status: 403 });

  const timeZone = await checkinTimezone(supabase, user.id, groupId);
  const weekStart = currentCheckinWeek(timeZone);
  const existing = await loadOwnCheckin(supabase, user.id, groupId, weekStart);
  if (!existing.available) return NextResponse.json({ error: "Check-ins aren't switched on yet. Try again soon." }, { status: 503 });
  if (existing.row?.reviewed_at) return NextResponse.json({ error: "Your coach already reviewed this week's check-in." }, { status: 409 });

  // Only the client's own photos (row security reads only theirs); each one sent is shared with the coach, which is what sending it means.
  let photoIds: string[] = [];
  if (cleaned.value.photo_ids.length > 0) {
    const { data: own } = await supabase.from("progress_photos").select("id").eq("athlete_id", user.id).eq("group_id", groupId).in("id", cleaned.value.photo_ids);
    const mine = new Set(((own ?? []) as { id: string }[]).map((p) => p.id));
    photoIds = cleaned.value.photo_ids.filter((id) => mine.has(id));
    if (photoIds.length > 0) await supabase.from("progress_photos").update({ shared_with_coach: true }).eq("athlete_id", user.id).in("id", photoIds);
  }

  const [snapshot, coach] = await Promise.all([loadCheckinSnapshot(supabase, { athleteId: user.id, groupId, weekStart, timeZone }), checkinCoach(supabase, groupId, user.id)]);
  const fields = { ...cleaned.value, photo_ids: photoIds, auto_snapshot: snapshot, submitted_at: new Date().toISOString() };

  const write = existing.row
    ? await supabase.from("weekly_checkins").update(fields).eq("id", existing.row.id).is("reviewed_at", null).select("id")
    : await supabase.from("weekly_checkins").insert({ ...fields, group_id: groupId, athlete_id: user.id, coach_id: coach?.id ?? null, week_start: weekStart }).select("id");
  if (write.error || !write.data || write.data.length === 0) {
    if (write.error && isMissingSchema(write.error)) return NextResponse.json({ error: "Check-ins aren't switched on yet. Try again soon." }, { status: 503 });
    // a second tab that sent the same week a moment ago
    if (write.error?.code === "23505") return NextResponse.json({ error: "This week's check-in was just sent. Open it again to change it." }, { status: 409 });
    return NextResponse.json({ error: "Couldn't send your check-in. Try again." }, { status: 500 });
  }

  if (!existing.row && coach) {
    const db = createServiceRoleClient();
    const { data: me } = await db.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    const words = coachNotice(((me?.full_name as string | null) ?? "").trim());
    await db.from("notifications").insert({ profile_id: coach.id, group_id: groupId, type: "weekly_checkin", body: words.notice, link_path: COACH_CHECKINS_PATH });
    await sendCoachPush(db, coach.id, "client_activity", words.title, words.body, COACH_CHECKINS_PATH).catch(() => 0);
  }
  return NextResponse.json({ ok: true, id: (write.data[0] as { id: string }).id, weekStart, edited: !!existing.row });
}
