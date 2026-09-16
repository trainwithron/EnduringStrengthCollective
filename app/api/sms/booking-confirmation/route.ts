import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { dispatchSms } from "@/lib/sms-dispatch";

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

  const serviceRole = createServiceRoleClient();

  const { data: coachRow } = await serviceRole
    .from("group_memberships")
    .select("profile_id, profiles ( full_name )")
    .eq("group_id", groupId)
    .eq("role", "coach")
    .limit(1)
    .maybeSingle();
  if (!coachRow) return NextResponse.json({ sent: false, reason: "no_coach" });

  const { data: athleteDetails } = await serviceRole
    .from("athlete_profile_details")
    .select("phone")
    .eq("athlete_id", athleteId)
    .maybeSingle();

  const coachName = (coachRow as any).profiles?.full_name ?? "your coach";
  const when = new Date(startAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const result = await dispatchSms(serviceRole, {
    coachId: coachRow.profile_id,
    recipientPhone: athleteDetails?.phone,
    messageType: "booking_confirmation",
    referenceId: `${athleteId}:${groupId}:${startAt}`,
    body: `You're booked with ${coachName} for ${when}.`,
  });

  return NextResponse.json(result);
}
