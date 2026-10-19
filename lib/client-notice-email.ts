import type { SupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { isPlaceholderEmail } from "@/lib/placeholder-email";
import { isQuietNow, readPushPrefs } from "@/lib/push-prefs";
import { configuredAppUrl } from "@/lib/app-url";

// A client's session reminder and booking confirmation reach them by phone alert ONLY when they have turned alerts on, and almost nobody has (Oct 19 audit: 4 push subscriptions for 3 people in the whole
// database, 25 upcoming sessions across 6 clients). So when a phone alert reached no one, the same one line goes by email. Plain text, transactional only, one email per booking per event, never in the person's
// quiet hours (dropped, not queued), never to a placeholder address (a client set up by their coach who has not claimed the account). "Good job" stays phone-only.
const ALERTS_LINE = "Turn on alerts in Settings > Notifications to get these on your phone.";

const firstName = (full: string | null | undefined): string => (full ?? "").trim().split(/\s+/)[0] || "your coach";

function calendarLine(groupId: string): string {
  const base = configuredAppUrl();
  return base ? `Your calendar: ${base}/groups/${groupId}/calendar\n\n` : "";
}

/** "Your session today at 3:00 PM" / "Your session with Ron starts at 3:00 PM." */
export function reminderEmail(opts: { coachName: string | null | undefined; time: string; groupId: string }): { subject: string; text: string } {
  return {
    subject: `Your session today at ${opts.time}`,
    text: `Your session with ${firstName(opts.coachName)} starts at ${opts.time}.\n\n${calendarLine(opts.groupId)}${ALERTS_LINE}\n`,
  };
}

/** "Session confirmed: Mon, Oct 19 at 3:00 PM" */
export function confirmationEmail(opts: { coachName: string | null | undefined; when: string; groupId: string }): { subject: string; text: string } {
  return {
    subject: `Session confirmed: ${opts.when}`,
    text: `You're booked with ${firstName(opts.coachName)} for ${opts.when}.\n\n${calendarLine(opts.groupId)}${ALERTS_LINE}\n`,
  };
}

export type EmailOutcome = "sent" | "quiet" | "no_address" | "not_configured" | "failed";

/** Emails the client the notice when allowed. Used only AFTER a phone alert reached no one. */
export async function emailClientNotice(db: SupabaseClient, profileId: string, subject: string, text: string): Promise<EmailOutcome> {
  if (!isEmailConfigured()) return "not_configured";
  const prefs = await readPushPrefs(db, profileId);
  if (isQuietNow(prefs)) return "quiet";
  const { data } = await db.auth.admin.getUserById(profileId);
  const to = data?.user?.email;
  if (!to || isPlaceholderEmail(to)) return "no_address";
  return (await sendEmail(to, subject, text)) ? "sent" : "failed";
}

/**
 * Was the reminder/confirmation delivered through any channel? A phone alert reached at least one phone, a text went out, or an email was accepted. When none did, a reminder is not counted as sent and its claim
 * is given back (while the session has not started) so the next run tries again.
 */
export function wasDelivered(r: { pushCount: number; smsSent: boolean; email: EmailOutcome | null }): boolean {
  return r.pushCount > 0 || r.smsSent || r.email === "sent";
}

/** Give the claim back only when nothing was delivered and the session has not started. */
export function shouldReleaseClaim(delivered: boolean, startAt: Date | string, now: Date = new Date()): boolean {
  return !delivered && new Date(startAt).getTime() > now.getTime();
}
