import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";

// acuity_replacement_gap_audit_sept16.md — waitlists. The instant "a
// slot just freed up" moment is handled synchronously inside
// cancel_booking_and_refund_credit/reschedule_booking (real SQL,
// inserts the in-app notification immediately via
// offer_freed_slot_to_waitlist). This cron handles the two things that
// genuinely need to run outside a database transaction: sending the
// actual push (needs the web-push library, not available in plpgsql)
// and expiring a stale offer to cascade to the next person in line.
// Runs every 5 minutes, same cadence as webhook-retry/session-reminder.
export async function GET(request: Request) {
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
    const when = new Date(entry.slot_start_at).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const body = `A spot just opened up for ${when} — book now before it's gone.`;
    await sendPushToProfile(supabase, entry.athlete_id, "Waitlist spot open", body, `/groups/${entry.group_id}/calendar`);
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

  return NextResponse.json({ ok: true, pushed, expired });
}
