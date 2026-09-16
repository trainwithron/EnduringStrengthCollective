import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";

// acuity_replacement_gap_audit_sept16.md — the single clearest,
// highest-value gap against Acuity: zero reminder/confirmation infra
// existed around bookings. This is the reminder half. Triggered by the
// Vercel Cron entry in vercel.json, same CRON_SECRET auth pattern as
// every other cron route (coach-digest, rest-day-nudge).
//
// Fixed lead time (1 hour) per the audit's own example — not a coach-
// configurable setting, since that's real, separate scope beyond
// tonight's build. reminder_sent_at (migration 0189) is the dedup
// guard: without it, a cron running every few minutes would re-fire
// the same reminder on every tick right up until the session starts.
// reschedule_booking resets that column to null on any reschedule, so
// a session moved to a new time correctly gets a fresh reminder.
const LEAD_TIME_MINUTES = 60;

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
  const windowEnd = new Date(now.getTime() + LEAD_TIME_MINUTES * 60 * 1000);

  // Real ambiguous-embed gotcha (postgrest_ambiguous_embed_silent_
  // failure_standing_rule.md): bookings has two FKs into profiles
  // (athlete_id, coach_id) — the explicit !bookings_coach_id_fkey hint
  // is required, or this silently returns zero rows instead of erroring.
  const { data: upcoming } = await supabase
    .from("bookings")
    .select("id, athlete_id, group_id, start_at, profiles!bookings_coach_id_fkey ( full_name )")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gte("start_at", now.toISOString())
    .lte("start_at", windowEnd.toISOString());

  let sent = 0;
  for (const booking of upcoming ?? []) {
    const coachName = (booking as any).profiles?.full_name ?? "your coach";
    const when = new Date(booking.start_at).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    const count = await sendPushToProfile(
      supabase,
      booking.athlete_id,
      "Upcoming session",
      `Your session with ${coachName} starts at ${when}.`,
      `/groups/${booking.group_id}/calendar`
    );
    // Mark as sent regardless of whether a real push subscription
    // existed to deliver to (count === 0) — the reminder "happened" for
    // this booking either way, and retrying every tick for a client
    // with push notifications off would just waste cron time forever.
    await supabase.from("bookings").update({ reminder_sent_at: now.toISOString() }).eq("id", booking.id);
    if (count > 0) sent += 1;
  }

  return NextResponse.json({ checked: upcoming?.length ?? 0, sent });
}
