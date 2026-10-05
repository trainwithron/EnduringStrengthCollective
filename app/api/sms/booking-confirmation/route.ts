import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dispatchSms } from "@/lib/sms-dispatch";
import { getCallerGroupRole } from "@/lib/group-access";

// Fired right after book_session() succeeds, from the same 3 call
// sites as lib/notify-booking-confirmed.ts's push version (self-book,
// coach-assign, expanded-day-scheduler) — see that file's own comment
// for why this has to be a fresh HTTP call rather than a DB trigger
// (no pg_net/webhook infra in this project).
//
// Deliberately re-resolves everything server-side from
// {athleteId, groupId, startAt} rather than trusting a client-supplied
// message body or coachId — same defensive shape as
// checkAndNotifyLowSessionBalance re-reading the balance itself. The
// booking RPC doesn't return the new row's id, so there's no bookingId
// to look up directly; the coach is resolved via group_memberships
// instead, and the reference_id for idempotency is a composite key
// (athleteId:groupId:startAt) — bookings_no_double_book already
// guarantees at most one confirmed booking per (coach, start_at), so
// this triple is a real, practically-unique key for one specific
// booking.
export async function POST(request: Request) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { athleteId, groupId, startAt } = await request.json();
  if (!athleteId || !groupId || !startAt) {
    return NextResponse.json({ error: "Missing athleteId, groupId, or startAt." }, { status: 400 });
  }

  // Only the athlete themself or a coach of that group can trigger this, and only for a booking that really
  // exists: it texts a real person, so a signed-in user must not be able to aim it at someone else's athleteId,
  // name a group they are not in, or invent a time.
  const role = await getCallerGroupRole(supabase, user.id, groupId);
  if (!role || (role === "athlete" && user.id !== athleteId)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const serviceRole = createServiceRoleClient();

  const { data: booking } = await serviceRole
    .from("bookings")
    .select("coach_id")
    .eq("athlete_id", athleteId)
    .eq("group_id", groupId)
    .eq("start_at", startAt)
    .eq("status", "confirmed")
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: "Not allowed." }, { status: 403 });

  const { data: coachRow } = await serviceRole
    .from("profiles")
    .select("id, full_name")
    .eq("id", booking.coach_id)
    .maybeSingle();
  if (!coachRow) return NextResponse.json({ sent: false, reason: "no_coach" });

  const coachName = coachRow.full_name ?? "your coach";
  const when = new Date(startAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const result = await dispatchSms(serviceRole, {
    coachId: coachRow.id,
    athleteId,
    messageType: "booking_confirmation",
    referenceId: `${athleteId}:${groupId}:${startAt}`,
    body: `You're booked with ${coachName} for ${when}.`,
  });

  return NextResponse.json(result);
}
