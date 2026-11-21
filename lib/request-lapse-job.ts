import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushToProfile } from "@/lib/send-push";
import { emailClientNotice, type EmailOutcome } from "@/lib/client-notice-email";
import { readPushPrefs } from "@/lib/push-prefs";
import { configuredAppUrl } from "@/lib/app-url";
import { requestHref } from "@/lib/requests-center";
import { shortName } from "@/lib/notification-push";
import { askedWhat, dueForLapseWarning, isUrgentRequest, lapsedMessage, lapseWarningMessage, LAPSE_WARNING_BEFORE_MS, requestDeadline } from "@/lib/request-deadline";

// The coach is warned about two hours before a waiting session request lapses, and told once it has lapsed (Ron, Nov 20, wave 3 C1). Run by the five-minute booking job, around
// the database call that lapses requests (expire_stale_booking_requests), which still decides WHEN a request lapses. A phone alert first; an email when no phone was reached
// (the C3 rule). Each is claimed once on the request (lapse_warned_at, lapse_told_at); a warning nothing delivered is given back and tried again until the request lapses.
// A request about a session starting soon (C9) reaches the coach even in their quiet hours.

type Row = {
  id: string;
  coach_id: string;
  kind: string | null;
  from_start_at: string | null;
  new_start_at: string;
  created_at: string;
  profiles?: { full_name?: string | null } | null;
};
const SELECT = "id, coach_id, kind, from_start_at, new_start_at, created_at, profiles!booking_requests_athlete_id_fkey ( full_name )";

async function deliver(db: SupabaseClient, coachId: string, msg: { title: string; body: string }, href: string, urgent: boolean): Promise<boolean> {
  const reached = await sendPushToProfile(db, coachId, msg.title, msg.body, href, urgent ? { ignoreQuiet: true } : {}).catch(() => 0);
  if (reached > 0) return true;
  const base = configuredAppUrl();
  const text = `${msg.body}\n\n${base ? `Open it: ${base}${href}\n\n` : ""}Turn on alerts in Settings > Notifications to get these on your phone instead.\n`;
  const email: EmailOutcome = await emailClientNotice(db, coachId, msg.title, text, { ignoreQuiet: urgent }).catch(() => "failed" as EmailOutcome);
  return email === "sent";
}

/** About two hours before a waiting request lapses: "Answer by 4:00 PM or it lapses." Before step 218 is applied the column is missing and nothing is sent. */
export async function warnBeforeLapse(db: SupabaseClient, now: Date = new Date()): Promise<{ warned: number; released: number } | { error: string }> {
  // the widest a deadline can be: a new session's time, or a move's original time (both within the next two hours when due)
  const horizon = new Date(now.getTime() + LAPSE_WARNING_BEFORE_MS).toISOString();
  const { data, error } = await db
    .from("booking_requests")
    .select(SELECT)
    .eq("status", "pending")
    .is("lapse_warned_at", null)
    .or(`and(kind.eq.move,from_start_at.lte.${horizon}),new_start_at.lte.${horizon}`)
    .gt("new_start_at", new Date(now.getTime() - 86400000).toISOString())
    .limit(500);
  if (error) return { error: "lapse warnings skipped: " + error.message };
  let warned = 0;
  let released = 0;
  for (const r of (data ?? []) as unknown as Row[]) {
    const deadline = requestDeadline(r);
    if (!dueForLapseWarning(deadline, now)) continue;
    const stamp = now.toISOString();
    const { data: claimed } = await db.from("booking_requests").update({ lapse_warned_at: stamp }).eq("id", r.id).eq("status", "pending").is("lapse_warned_at", null).select("id");
    if ((claimed ?? []).length === 0) continue;
    const tz = (await readPushPrefs(db, r.coach_id)).timeZone;
    const msg = lapseWarningMessage(shortName(r.profiles?.full_name), askedWhat(r, tz), deadline, tz, now);
    if (await deliver(db, r.coach_id, msg, requestHref("booking", r.id), isUrgentRequest(r))) {
      warned += 1;
    } else {
      await db.from("booking_requests").update({ lapse_warned_at: null }).eq("id", r.id).eq("lapse_warned_at", stamp);
      released += 1;
    }
  }
  return { warned, released };
}

/** After the database lapsed requests: who, what, and that the client was told. Only requests lapsed in the last day (a request lapsed before this existed is not news). */
export async function tellLapsed(db: SupabaseClient, now: Date = new Date()): Promise<{ told: number } | { error: string }> {
  const { data, error } = await db
    .from("booking_requests")
    .select(SELECT)
    .eq("status", "expired")
    .is("lapse_told_at", null)
    .gte("decided_at", new Date(now.getTime() - 86400000).toISOString())
    .limit(500);
  if (error) return { error: "lapse notices skipped: " + error.message };
  let told = 0;
  for (const r of (data ?? []) as unknown as Row[]) {
    const stamp = now.toISOString();
    const { data: claimed } = await db.from("booking_requests").update({ lapse_told_at: stamp }).eq("id", r.id).is("lapse_told_at", null).select("id");
    if ((claimed ?? []).length === 0) continue;
    const tz = (await readPushPrefs(db, r.coach_id)).timeZone;
    const msg = lapsedMessage(shortName(r.profiles?.full_name), askedWhat(r, tz));
    // Nothing delivered (the coach's quiet hours, or no phone and no email): given back, so the next run tries again (for up to a day after it lapsed).
    if (await deliver(db, r.coach_id, msg, requestHref("booking", r.id), isUrgentRequest(r))) told += 1;
    else await db.from("booking_requests").update({ lapse_told_at: null }).eq("id", r.id).eq("lapse_told_at", stamp);
  }
  return { told };
}
