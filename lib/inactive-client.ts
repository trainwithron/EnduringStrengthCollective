// A quiet suggestion, never a rule (Ron, Oct 6): some clients have effectively left, and some coaches would rather not keep chasing them. The app
// can notice the signs and offer "door open or set aside?", but it never decides, never messages, and never archives by itself. These thresholds are
// soft defaults, not a finding: a coach who dismisses the card is not asked again for a long while.

export const INACTIVE_AFTER_DAYS = 120; // no workout, session or message from the client for about four months
export const FEW_SESSIONS_EVER = 3; // only ever had this many sessions or fewer
export const LOW_BALANCE = 1; // one session left or fewer
export const UNANSWERED_MIN = 3; // coach messages with no reply
export const UNANSWERED_QUIET_DAYS = 14; // the last of them was at least this long ago
export const KEEP_ACTIVE_SNOOZE_DAYS = 90;

export interface InactiveSignals {
  name: string;
  // Days since the client's last workout, past session or message to the coach; null when there has been none at all.
  daysSinceActivity: number | null;
  // Days since they were added (used when there has been no activity at all).
  daysSinceAdded: number | null;
  balance: number;
  // Sessions ever given to them (assigned, purchased, opening balance).
  sessionsEverGranted: number;
  // Messages the coach sent after the client's last reply (or ever, if they never replied), and how long ago the latest one was.
  coachMessagesUnanswered: number;
  daysSinceLastCoachMessage: number | null;
}

export interface InactiveSuggestion {
  reasons: string[];
}

function ago(days: number): string {
  if (days >= 330) return "about a year ago";
  if (days >= 60) return `about ${Math.round(days / 30)} months ago`;
  return `${days} days ago`;
}

// Needs the first sign (a long quiet stretch) plus at least two of the others. Returns the plain reasons to show, or null.
export function inactiveSuggestion(s: InactiveSignals): InactiveSuggestion | null {
  const quietDays = s.daysSinceActivity ?? s.daysSinceAdded;
  if (quietDays == null || quietDays < INACTIVE_AFTER_DAYS) return null;

  const others: string[] = [];
  if (s.balance <= LOW_BALANCE) others.push(s.balance === 1 ? "1 session left" : "no sessions left");
  if (s.sessionsEverGranted <= FEW_SESSIONS_EVER && s.sessionsEverGranted > 0) {
    others.push(`only ever had ${s.sessionsEverGranted} ${s.sessionsEverGranted === 1 ? "session" : "sessions"}`);
  }
  if (
    s.coachMessagesUnanswered >= UNANSWERED_MIN &&
    s.daysSinceLastCoachMessage != null &&
    s.daysSinceLastCoachMessage >= UNANSWERED_QUIET_DAYS
  ) {
    others.push(`${s.coachMessagesUnanswered} messages without a reply`);
  }
  if (others.length < 2) return null;

  const first = s.daysSinceActivity == null ? "no workout yet since they were added" : `last activity ${ago(s.daysSinceActivity)}`;
  return { reasons: [first, ...others] };
}

// A warm door-open note for the coach to edit and send. No guilt, no mention of money.
export function buildDoorOpenDraft(firstName: string): string {
  const name = firstName.trim() || "there";
  return `Hi ${name}, no pressure at all. I just wanted you to know my door is always open if you ever want to train again. I hope things are going well for you.`;
}

// "Not now" (a short snooze) and "Keep active" (a long one) are kept apart so the coach's own answer is visible in the Spotter feedback.
export const NOT_NOW_SNOOZE_DAYS = 14;

export function inactiveDismissalKey(athleteId: string, groupId: string): string {
  return `inactive::${athleteId}::${groupId}`;
}

export function inactiveKeepActiveKey(athleteId: string, groupId: string): string {
  return `inactive-keep::${athleteId}::${groupId}`;
}

export function isSnoozedFor(lastAnsweredAt: string | null | undefined, days: number, now: Date): boolean {
  if (!lastAnsweredAt) return false;
  return now.getTime() - new Date(lastAnsweredAt).getTime() < days * 86400000;
}

// The messages between the coach and one client, as the quiet-client suggestion reads them. A reply the database wrote from the coach's "I'm away" preset (auto_reply) is not the coach
// reaching out, so it is left out: a client who wrote while the coach was away and then went quiet must not read as "you messaged them and they have not answered".
export function inactiveThread(
  rows: { group_id: string; sender_id: string; recipient_id: string; created_at: string; auto_reply?: boolean | null }[],
  clientId: string,
  groupId: string
): { fromClient: boolean; at: string }[] {
  return rows
    .filter((x) => x.group_id === groupId && (x.sender_id === clientId || x.recipient_id === clientId) && !x.auto_reply)
    .map((x) => ({ fromClient: x.sender_id === clientId, at: x.created_at }));
}

// How long the unanswered stretch has been, from the messages between coach and client (newest last or any order).
export function unansweredFromMessages(
  messages: { fromClient: boolean; at: string }[],
  now: Date
): { unanswered: number; daysSinceLastCoachMessage: number | null } {
  const lastReply = messages.filter((m) => m.fromClient).reduce((max, m) => Math.max(max, new Date(m.at).getTime()), 0);
  const coach = messages.filter((m) => !m.fromClient && new Date(m.at).getTime() > lastReply);
  if (coach.length === 0) return { unanswered: 0, daysSinceLastCoachMessage: null };
  const latest = coach.reduce((max, m) => Math.max(max, new Date(m.at).getTime()), 0);
  return { unanswered: coach.length, daysSinceLastCoachMessage: Math.floor((now.getTime() - latest) / 86400000) };
}
