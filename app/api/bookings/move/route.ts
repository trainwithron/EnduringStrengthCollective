import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { authorizeCoachCall, isResponse } from "@/lib/series-route";
import { planBookingMove } from "@/lib/booking-move";

// The coach moves ONE session to another day, keeping its time of day: { bookingId, newDateKey: "YYYY-MM-DD" } (the day on the coach's own clock). It stays the SAME booking: the row's start and end change and nothing else
// (its credit state is untouched, so a session waiting to be marked is still waiting, and nothing is taken or given back). A session in a weekly schedule leaves its old slot on the schedule's skipped list, so the daily
// top-up does not book that slot again. Past days are allowed (a correction); a session already marked attended or not charged is refused. Only a coach of that session's group can do this.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId : null;
  if (!bookingId) return NextResponse.json({ error: "Missing session." }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: booking } = await db
    .from("bookings")
    .select("id, coach_id, athlete_id, group_id, start_at, end_at, status, attended_at, credit_state, no_show, recurring_series_id")
    .eq("id", bookingId)
    .maybeSingle();
  // The group comes from the stored session, never from the request.
  const call = await authorizeCoachCall((booking as { group_id?: string } | null)?.group_id ?? null);
  if (isResponse(call)) return call;
  if (!booking) return NextResponse.json({ error: "That session was not found." }, { status: 404 });

  const b = booking as { id: string; coach_id: string; athlete_id: string; group_id: string; start_at: string; end_at: string; status: string; attended_at: string | null; credit_state: string; no_show: boolean | null; recurring_series_id: string | null };
  const context = await call.store.coachContext(b.coach_id);
  const plan = planBookingMove({ booking: { startAt: b.start_at, endAt: b.end_at, status: b.status, attendedAt: b.attended_at, creditState: b.credit_state, noShow: b.no_show }, newDateKey: body?.newDateKey, timezone: context.timezone });
  if (!plan.ok || !plan.startIso || !plan.endIso) return NextResponse.json({ error: plan.message ?? "That day can't be used." }, { status: 422 });
  if (plan.startIso === new Date(b.start_at).toISOString()) return NextResponse.json({ ok: true, unchanged: true, startIso: plan.startIso });

  // Never on top of another session (with the coach's gap between sessions), nor on a discovery call.
  const gapMs = (context.bufferMinutes ?? 0) * 60000;
  const from = new Date(new Date(plan.startIso).getTime() - gapMs).toISOString();
  const to = new Date(new Date(plan.endIso).getTime() + gapMs).toISOString();
  const [{ data: clash }, { data: callClash }] = await Promise.all([
    db.from("bookings").select("id").eq("coach_id", b.coach_id).eq("status", "confirmed").neq("id", b.id).lt("start_at", to).gt("end_at", from).limit(1),
    db.from("discovery_bookings").select("id").eq("coach_id", b.coach_id).eq("status", "confirmed").lt("start_at", to).gt("end_at", from).limit(1),
  ]);
  if ((clash ?? []).length > 0 || (callClash ?? []).length > 0) return NextResponse.json({ error: "That time is taken by another session." }, { status: 409 });

  const future = new Date(plan.startIso).getTime() > Date.now();
  const patch: Record<string, unknown> = { start_at: plan.startIso, end_at: plan.endIso };
  // A reminder already sent for the old time must not stop the new one.
  if (future) patch.reminder_sent_at = null;
  const { data: updated, error } = await db.from("bookings").update(patch).eq("id", b.id).eq("status", "confirmed").is("attended_at", null).select("id");
  if (error || !updated || updated.length === 0) return NextResponse.json({ error: "That didn't move. Nothing was changed." }, { status: 422 });

  // A session of a weekly schedule leaves its old slot on the skipped list, so the daily top-up does not book that slot again.
  if (b.recurring_series_id) {
    try {
      const series = await call.store.getSeries(b.recurring_series_id);
      const old = new Date(b.start_at).toISOString();
      if (series && !series.skippedStarts.some((s) => new Date(s).toISOString() === old)) await call.store.updateSeries(series.id, { skippedStarts: [...series.skippedStarts, old] });
    } catch {
      // The move itself is done; a failure here only means the old slot might be offered again by the top-up.
    }
  }
  await call.store.mirror(b.id);
  return NextResponse.json({ ok: true, startIso: plan.startIso });
}
