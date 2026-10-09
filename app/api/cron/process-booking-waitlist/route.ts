import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { formatInTimezone, timezoneForProfiles } from "@/lib/format-in-timezone";
import { dateKeyInZone } from "@/lib/timezone";
import { withCronRun } from "@/lib/cron-monitor";

// acuity_replacement_gap_audit_sept16.md — waitlists. The instant "a
// slot just freed up" moment is handled synchronously inside
// cancel_booking_and_refund_credit/reschedule_booking (real SQL,
// inserts the in-app notification immediately via
// offer_freed_slot_to_waitlist). This cron handles the two things that
// genuinely need to run outside a database transaction: sending the
// actual push (needs the web-push library, not available in plpgsql)
// and expiring a stale offer to cascade to the next person in line.
// Runs every 5 minutes, same cadence as webhook-retry/session-reminder.
async function handler(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET isn't configured." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = new Date();

  const { data: toPush } = await supabase
    .from("booking_waitlist_entries")
    .select("id, athlete_id, group_id, slot_start_at")
    .eq("status", "offered")
    .is("push_sent_at", null);

  let pushed = 0;
  for (const entry of toPush ?? []) {
    const athleteZone = await timezoneForProfiles(supabase, [entry.athlete_id]);
    const when = formatInTimezone(entry.slot_start_at, athleteZone, "dateTime");
    // The calendar day of the freed slot, as the client reads it, so the tap lands on that day's open times.
    const slotDay = dateKeyInZone(athleteZone ?? "UTC", new Date(entry.slot_start_at));
    const body = `A spot just opened up for ${when} — book now before it's gone.`;
    await sendPushToProfile(supabase, entry.athlete_id, "Waitlist spot open", body, `/groups/${entry.group_id}/calendar/${slotDay}`);
    await supabase.from("booking_waitlist_entries").update({ push_sent_at: now.toISOString() }).eq("id", entry.id);
    pushed++;
  }

  const { data: expiredCandidates } = await supabase
    .from("booking_waitlist_entries")
    .select("id, coach_id, slot_start_at, slot_end_at")
    .eq("status", "offered")
    .lt("offer_expires_at", now.toISOString());

  let expired = 0;
  for (const entry of expiredCandidates ?? []) {
    await supabase.from("booking_waitlist_entries").update({ status: "expired" }).eq("id", entry.id);
    // Cascades to the next waiting person for this exact slot, if any —
    // same real SQL function cancel/reschedule already use.
    await supabase.rpc("offer_freed_slot_to_waitlist", {
      p_coach_id: entry.coach_id,
      p_start_at: entry.slot_start_at,
      p_end_at: entry.slot_end_at,
    });
    expired++;
  }

  // A pending booking request whose time has passed lapses and the client is told (needs the booking requests database update; until then
  // the call fails quietly).
  const { data: lapsed } = await supabase.rpc("expire_stale_booking_requests");

  return NextResponse.json({ ok: true, pushed, expired, lapsedRequests: typeof lapsed === "number" ? lapsed : 0 });
}

export const GET = withCronRun("process-booking-waitlist", handler);
