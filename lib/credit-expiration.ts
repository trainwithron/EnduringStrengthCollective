// acuity_replacement_gap_audit_sept16.md — pure logic behind the credit-
// expiration cron (app/api/cron/expire-session-credits/route.ts) and the
// small "credits expire on X" UI note. Coarse whole-balance model: a
// coach's credit_expiry_days (0 = never expires, the default for every
// existing coach) counted from the athlete's own last real grant.
export function isCreditBalanceExpired(
  lastGrantedAt: string | null,
  creditExpiryDays: number,
  now: Date
): boolean {
  if (creditExpiryDays <= 0 || !lastGrantedAt) return false;
  const cutoff = new Date(lastGrantedAt).getTime() + creditExpiryDays * 86400000;
  return now.getTime() >= cutoff;
}

export function creditExpiryDate(lastGrantedAt: string | null, creditExpiryDays: number): Date | null {
  if (creditExpiryDays <= 0 || !lastGrantedAt) return null;
  return new Date(new Date(lastGrantedAt).getTime() + creditExpiryDays * 86400000);
}

// How many sessions the nightly job may take away from a balance that has run past its expiry. Sessions already booked ahead (they take one when they happen) and
// sessions that have happened but are not marked yet (they take one when the coach marks them) are NOT unused, so they are kept; only what is left above them
// expires. Never negative, never more than the balance.
export function creditToExpire(balance: number, bookedAhead: number, toMark: number): number {
  const keep = Math.max(0, bookedAhead) + Math.max(0, toMark);
  return Math.max(0, Math.min(balance, balance - keep));
}
