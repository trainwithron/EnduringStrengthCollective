import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { dispatchSms } from "@/lib/sms-dispatch";
import { formatInTimezone, timezoneForProfiles } from "@/lib/format-in-timezone";
import { withCronRun } from "@/lib/cron-monitor";
import { emailClientNotice, reminderEmail, shouldReleaseClaim, wasDelivered, type EmailOutcome } from "@/lib/client-notice-email";

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

// A scheduled job that loops over people needs room to finish: the function may run up to five minutes (the default is far shorter, and a long list would be cut off part way).
export const maxDuration = 300;
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
  const windowEnd = new Date(now.getTime() + LEAD_TIME_MINUTES * 60 * 1000);

  // Real ambiguous-embed gotcha (postgrest_ambiguous_embed_silent_
  // failure_standing_rule.md): bookings has two FKs into profiles
  // (athlete_id, coach_id) — the explicit !bookings_coach_id_fkey hint
  // is required, or this silently returns zero rows instead of erroring.
  const { data: upcoming } = await supabase
    .from("bookings")
    .select(
      "id, athlete_id, coach_id, group_id, start_at, profiles!bookings_coach_id_fkey ( full_name )"
    )
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gte("start_at", now.toISOString())
    .lte("start_at", windowEnd.toISOString());

  let sent = 0;
  let smsSent = 0;
  let emailed = 0;
  let released = 0;
  for (const booking of upcoming ?? []) {
    // The reminder is CLAIMED first (only if nobody has yet): if marking it fails, nothing is sent, so a failed write can never make the same reminder go out again on every run, and two overlapping runs
    // cannot both send it.
    const { data: claimed, error: claimError } = await supabase
      .from("bookings")
      .update({ reminder_sent_at: now.toISOString() })
      .eq("id", booking.id)
      .is("reminder_sent_at", null)
      .select("id");
    if (claimError || (claimed ?? []).length === 0) continue;
    const coachName = (booking as any).profiles?.full_name ?? "your coach";
    // In the client's own time zone (this runs in UTC): their profile first, then their coach's.
    const when = formatInTimezone(
      booking.start_at,
      await timezoneForProfiles(supabase, [booking.athlete_id, booking.coach_id]),
      "time"
    );
    const count = await sendPushToProfile(
      supabase,
      booking.athlete_id,
      "Upcoming session",
      `Your session with ${coachName} starts at ${when}.`,
      `/groups/${booking.group_id}/calendar`
    );

    // SMS mirror — a separate, opt-in channel a coach can turn on
    // ON TOP of push (see lib/sms-dispatch.ts), not a replacement.
    // Reuses this exact same query/window/dedup pass rather than a
    // second cron: reminder_sent_at is one dedup guard for "the
    // reminder moment happened," regardless of which channel(s) fired.
    const smsResult = await dispatchSms(supabase, {
      coachId: booking.coach_id,
      athleteId: booking.athlete_id,
      messageType: "session_reminder",
      referenceId: booking.id,
      body: `Reminder: your session with ${coachName} starts at ${when}.`,
    });
    if (smsResult.sent) smsSent += 1;

    // Almost no client has phone alerts on, so when neither a phone alert nor a text reached them the same line goes by email (not in their quiet hours; never to a placeholder address).
    let email: EmailOutcome | null = null;
    if (count === 0 && !smsResult.sent) {
      const mail = reminderEmail({ coachName: (booking as any).profiles?.full_name, time: when, groupId: booking.group_id });
      email = await emailClientNotice(supabase, booking.athlete_id, mail.subject, mail.text).catch(() => "failed" as EmailOutcome);
      if (email === "sent") emailed += 1;
    }

    // The reminder counts as sent only if some channel delivered it. Otherwise the claim is given back (while the session has not started) so the next run tries again.
    const delivered = wasDelivered({ pushCount: count, smsSent: !!smsResult.sent, email });
    if (shouldReleaseClaim(delivered, booking.start_at, now)) {
      await supabase.from("bookings").update({ reminder_sent_at: null }).eq("id", booking.id).eq("reminder_sent_at", now.toISOString());
      released += 1;
      continue;
    }
    if (delivered) sent += 1;
  }

  return NextResponse.json({ checked: upcoming?.length ?? 0, sent, smsSent, emailed, released });
}

export const GET = withCronRun("session-reminder", handler);
