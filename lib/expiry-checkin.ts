// The quiet prompts around credit expiry (Ron, Oct 6): a human check-in BEFORE a client's sessions expire, and a "returned after a while" prompt
// when a client comes back after some sessions already expired. Both only suggest; the coach decides, and nothing happens automatically.

export const DEFAULT_HEADS_UP_DAYS = 30;
const DAY = 86400000;

export interface ExpiringRow {
  athleteId: string;
  groupId: string;
  balance: number;
  lastGrantedAt: string | null;
  // While this is in the future the nightly job leaves the balance alone.
  holdUntil: string | null;
}

export interface ExpiringSoon {
  athleteId: string;
  groupId: string;
  balance: number;
  expiresOn: Date;
  daysLeft: number;
}

// Whole days from `now` to `date`, rounded up (a session that expires later today has 1 day left, not 0).
export function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / DAY);
}

// Clients whose sessions will expire within the coach's heads-up window. Never includes a balance with nothing left, a coach with no expiry window,
// a client whose expiry is on hold, or a balance that has already passed its date (the nightly job handles that, and the returning-client prompt
// covers what comes after).
export function expiringSoon(rows: ExpiringRow[], expiryDays: number, headsUpDays: number, now: Date): ExpiringSoon[] {
  if (expiryDays <= 0 || headsUpDays <= 0) return [];
  const out: ExpiringSoon[] = [];
  for (const r of rows) {
    if (r.balance <= 0 || !r.lastGrantedAt) continue;
    if (r.holdUntil && new Date(r.holdUntil).getTime() > now.getTime()) continue;
    const expiresOn = new Date(new Date(r.lastGrantedAt).getTime() + expiryDays * DAY);
    const daysLeft = daysUntil(expiresOn, now);
    if (daysLeft < 1 || daysLeft > headsUpDays) continue;
    out.push({ athleteId: r.athleteId, groupId: r.groupId, balance: r.balance, expiresOn, daysLeft });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

// "Extend" means: the new hold ends N days after the date the sessions were due to expire (or from now if that date has passed).
export function holdUntilAfterExtension(expiresOn: Date, extraDays: number, now: Date): Date {
  const base = Math.max(expiresOn.getTime(), now.getTime());
  return new Date(base + extraDays * DAY);
}

export function pauseUntil(now: Date): Date {
  return new Date(now.getTime() + 365 * DAY);
}

// A short, warm check-in the coach reads and edits before sending. No pressure, no mention of money.
export function buildCheckInDraft(input: { firstName: string; balance: number; daysLeft: number }): string {
  const name = input.firstName.trim() || "there";
  const sessions = `${input.balance} ${input.balance === 1 ? "session" : "sessions"}`;
  const days = input.daysLeft === 1 ? "tomorrow" : `in about ${input.daysLeft} days`;
  return `Hi ${name}, I noticed you have ${sessions} left that will expire ${days}. How are things going? Anything getting in the way, or anything I can do to help you get back to what you're working toward?`;
}

export interface ReturningClient {
  athleteId: string;
  groupId: string;
  expiredOn: Date;
  reinstatable: number;
  monthsAway: number;
}

// A client who still has expired sessions that were not given back and has trained or been scheduled since they expired. The coach decides
// case by case whether to honor them.
export function returningClient(input: {
  athleteId: string;
  groupId: string;
  expiredOn: Date | null;
  reinstatable: number;
  lastActivityAt: Date | null;
  now: Date;
}): ReturningClient | null {
  const { expiredOn, reinstatable, lastActivityAt } = input;
  if (!expiredOn || reinstatable < 1 || !lastActivityAt) return null;
  if (lastActivityAt.getTime() <= expiredOn.getTime()) return null;
  const monthsAway = Math.max(1, Math.round((lastActivityAt.getTime() - expiredOn.getTime()) / (30.4 * DAY)));
  return { athleteId: input.athleteId, groupId: input.groupId, expiredOn, reinstatable, monthsAway };
}

// Snoozed after "Not now": the prompt stays away for this many days.
export const SNOOZE_DAYS = 14;
export function isSnoozed(lastDeniedAt: string | null, now: Date): boolean {
  if (!lastDeniedAt) return false;
  return now.getTime() - new Date(lastDeniedAt).getTime() < SNOOZE_DAYS * DAY;
}

export function expiryDismissalKey(athleteId: string, groupId: string, kind: "soon" | "returning"): string {
  return `expiry-${kind}::${athleteId}::${groupId}`;
}

// The plain sentence a client sees where their balance is shown, so a window is never a surprise.
export function expiryWindowLine(expiryDays: number): string | null {
  if (expiryDays <= 0) return null;
  return `Unused sessions expire ${expiryDays} days after your last purchase. If life gets in the way, talk to your coach before then.`;
}
