import type { SupabaseClient } from "@supabase/supabase-js";
import { configuredAppUrl } from "@/lib/app-url";
import { emailClientNotice, type EmailOutcome } from "@/lib/client-notice-email";
import { noticeHref } from "@/lib/notice-links";
import { pushTitleFor } from "@/lib/notification-push";

// An email when a phone alert reached none of the person's phones (Ron, Nov 20, wave 2 C3: "we can send the emails"). Only for the things someone is waiting on: a coach's
// requests to answer (a session asked for, a weekly-schedule change, someone asking to train) and a client's answer from their coach. Transactional, through the existing
// sender: one email per notice (the notice is claimed once, so it is emailed at most once), never in the person's quiet hours, never to a placeholder address
// (emailClientNotice). Nothing else is emailed.
export const EMAIL_BACKUP_TYPES = ["booking_request", "schedule_request", "client_request", "request_decision"] as const;

export function emailsWhenNoPhone(type: string): boolean {
  return (EMAIL_BACKUP_TYPES as readonly string[]).includes(type);
}

const ALERTS_LINE = "Turn on alerts in Settings > Notifications to get these on your phone instead.";

/** The email: the push's own title, the line (who and when for a request; the database's own line for an answer), and a link straight to it. */
export function noticeBackupEmail(n: { id: string; type: string; group_id: string | null; link_path: string | null }, line: string): { subject: string; text: string } {
  const base = configuredAppUrl();
  const href = noticeHref(n.type, n.link_path || "/dashboard", { id: n.id, groupId: n.group_id });
  const open = base ? `Open it: ${base}${href}\n\n` : "";
  const body = line.trim().replace(/\.?$/, ".");
  return { subject: pushTitleFor(n.type), text: `${body}\n\n${open}${ALERTS_LINE}\n` };
}

/** Sends the backup for a notice no phone received. Never throws. */
export async function emailNoticeBackup(
  db: SupabaseClient,
  n: { id: string; profile_id: string; type: string; group_id: string | null; link_path: string | null },
  line: string,
  // a request about a session starting soon reaches the coach even in their quiet hours (wave 3 C9)
  opts: { ignoreQuiet?: boolean } = {}
): Promise<EmailOutcome | null> {
  if (!emailsWhenNoPhone(n.type)) return null;
  try {
    const mail = noticeBackupEmail(n, line);
    return await emailClientNotice(db, n.profile_id, mail.subject, mail.text, opts);
  } catch {
    return "failed";
  }
}
