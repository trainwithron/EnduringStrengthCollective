import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendPushToProfile } from "@/lib/send-push";
import { dispatchSms } from "@/lib/sms-dispatch";
import { formatInTimezone, timezoneForProfiles } from "@/lib/format-in-timezone";
import { withCronRun } from "@/lib/cron-monitor";
import { dayBeforeEmail, emailClientNotice, reminderEmail, shouldReleaseClaim, wasDelivered, type EmailOutcome } from "@/lib/client-notice-email";
import { DAY_BEFORE_MIN_AHEAD_HOURS, dayBeforeDue, dayBeforeMessage, dayBeforeWindow, type QuietPrefs } from "@/lib/day-before-reminder";
import { DEFAULT_CANCELLATION_WINDOW_HOURS } from "@/lib/cancel-window";
import { DEFAULT_COACH_TIMEZONE } from "@/lib/timezone";

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
    // About their own session, an hour away: it goes through their quiet hours (Ron, Nov 20, R8), by push and by the email backup alike.
    const count = await sendPushToProfile(
      supabase,
      booking.athlete_id,
      "Upcoming session",
      `Your session with ${coachName} starts at ${when}.`,
      `/groups/${booking.group_id}/calendar`,
      { ignoreQuiet: true }
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
      email = await emailClientNotice(supabase, booking.athlete_id, mail.subject, mail.text, { ignoreQuiet: true }).catch(() => "failed" as EmailOutcome);
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

  const dayBefore = await dayBeforePass(supabase, now);
  return NextResponse.json({ checked: upcoming?.length ?? 0, sent, smsSent, emailed, released, dayBefore });
}

// The day-before reminder (Ron, Nov 20, wave 2 C2), timed to each coach's cancel window (lib/day-before-reminder.ts). Same run, same channels: a phone alert first, an email when no phone was reached.
// Claimed per start time before anything is sent (bookings.day_before_reminded_for = the start time), and given back when nothing was delivered (it is tried again until the cutoff).
const DAY_BEFORE_LOOK_AHEAD_DAYS = 8;
async function dayBeforePass(supabase: ReturnType<typeof createServiceRoleClient>, now: Date): Promise<{ checked: number; sent: number; emailed: number; released: number } | { error: string }> {
  const { data: rows, error } = await supabase
    .from("bookings")
    .select("id, athlete_id, coach_id, group_id, start_at, created_at, day_before_reminded_for, profiles!bookings_coach_id_fkey ( full_name )")
    .eq("status", "confirmed")
    .gte("start_at", new Date(now.getTime() + DAY_BEFORE_MIN_AHEAD_HOURS * 3600000).toISOString())
    .lte("start_at", new Date(now.getTime() + DAY_BEFORE_LOOK_AHEAD_DAYS * 86400000).toISOString())
    .order("start_at")
    .limit(2000);
  // Before step 214 is applied the column is not there: nothing is sent, and the one-hour reminder above is unaffected.
  if (error) return { error: "day-before reminders skipped: " + error.message };
  type Row = { id: string; athlete_id: string; coach_id: string; group_id: string; start_at: string; created_at: string | null; day_before_reminded_for: string | null; profiles?: { full_name?: string | null } | null };
  const bookings = (rows ?? []) as unknown as Row[];
  const coachIds = [...new Set(bookings.map((b) => b.coach_id))];
  const windowByCoach = new Map<string, number>();
  for (let i = 0; i < coachIds.length; i += 100) {
    const { data: policies } = await supabase.from("coach_booking_policies").select("coach_id, cancellation_window_hours").in("coach_id", coachIds.slice(i, i + 100));
    for (const p of (policies ?? []) as { coach_id: string; cancellation_window_hours: number | null }[]) windowByCoach.set(p.coach_id, p.cancellation_window_hours ?? DEFAULT_CANCELLATION_WINDOW_HOURS);
  }
  // Each client's quiet hours (R8): the reminder never goes out inside them; it moves to just before they begin. In the client's own time zone, else their coach's.
  const people = [...new Set(bookings.flatMap((b) => [b.athlete_id, b.coach_id]))];
  const prefsById = new Map<string, { quiet_hours_start: number | null; quiet_hours_end: number | null; timezone: string | null }>();
  for (let i = 0; i < people.length; i += 100) {
    const { data: profs, error: profError } = await supabase.from("profiles").select("id, quiet_hours_start, quiet_hours_end, timezone").in("id", people.slice(i, i + 100));
    // unknown quiet hours: nothing is sent this run rather than one landing inside them
    if (profError) return { error: "day-before reminders skipped: " + profError.message };
    for (const p of (profs ?? []) as any[]) prefsById.set(p.id, p);
  }
  const quietOf = (b: Row): QuietPrefs => {
    const me = prefsById.get(b.athlete_id);
    return { quietStart: me?.quiet_hours_start ?? null, quietEnd: me?.quiet_hours_end ?? null, timeZone: me?.timezone || prefsById.get(b.coach_id)?.timezone || DEFAULT_COACH_TIMEZONE };
  };
  let sent = 0;
  let emailed = 0;
  let released = 0;
  const due = bookings.filter((b) =>
    dayBeforeDue({ startAt: b.start_at, createdAt: b.created_at, remindedFor: b.day_before_reminded_for, windowHours: windowByCoach.get(b.coach_id) }, now, quietOf(b))
  );
  for (const b of due) {
    // One spelling of the time for every write below (the database compares the moment, not the text).
    const startIso = new Date(b.start_at).toISOString();
    // Claimed for this start time only if nobody has yet and the session has not moved since it was read.
    const { data: claimed, error: claimError } = await supabase
      .from("bookings")
      .update({ day_before_reminded_for: startIso })
      .eq("id", b.id)
      .eq("status", "confirmed")
      .eq("start_at", startIso)
      .or(`day_before_reminded_for.is.null,day_before_reminded_for.neq.${startIso}`)
      .select("id");
    if (claimError || (claimed ?? []).length === 0) continue;
    const timeZone = (await timezoneForProfiles(supabase, [b.athlete_id, b.coach_id])) ?? DEFAULT_COACH_TIMEZONE;
    const message = dayBeforeMessage({ startAt: startIso, windowHours: windowByCoach.get(b.coach_id), coachName: b.profiles?.full_name, timeZone, now });
    const count = await sendPushToProfile(supabase, b.athlete_id, message.title, message.body, `/groups/${b.group_id}/calendar`).catch(() => 0);
    let email: EmailOutcome | null = null;
    if (count === 0) {
      const mail = dayBeforeEmail({ ...message, groupId: b.group_id });
      email = await emailClientNotice(supabase, b.athlete_id, mail.subject, mail.text).catch(() => "failed" as EmailOutcome);
      if (email === "sent") emailed += 1;
    }
    const delivered = wasDelivered({ pushCount: count, smsSent: false, email });
    if (!delivered && now.getTime() < dayBeforeWindow(startIso, windowByCoach.get(b.coach_id), quietOf(b)).until.getTime()) {
      await supabase.from("bookings").update({ day_before_reminded_for: null }).eq("id", b.id).eq("day_before_reminded_for", startIso);
      released += 1;
      continue;
    }
    if (delivered) sent += 1;
  }
  return { checked: due.length, sent, emailed, released };
}

export const GET = withCronRun("session-reminder", handler);
