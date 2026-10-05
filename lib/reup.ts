// Running out of sessions: who needs to pay, what the coach sees, what the client sees, who to remind and how often.
//
// The balance has no floor (0248). Below zero a coach reads it as "Owed N sessions"; the client always sees neutral words
// (lib/session-credit-copy.ts). A client with no balance row has never been put on sessions, which is a different state from
// "used them all", so they are never counted as needing payment. A coach can put a client on hold (comped, on a break, pays
// another way) and then they are left out of the count and never reminded.

export function needsPayment(balance: number | null | undefined, onHold: boolean | null | undefined): boolean {
  if (balance === null || balance === undefined) return false;
  if (onHold) return false;
  return balance <= 0;
}

// What the COACH reads next to a client. Negative means the client has had sessions they have not paid for yet.
export function coachBalanceLabel(balance: number | null | undefined): string {
  if (balance === null || balance === undefined) return "No sessions set up";
  if (balance < 0) return `Owed ${Math.abs(balance)}`;
  if (balance === 0) return "0 left";
  return `${balance} left`;
}

export function countNeedingPayment(rows: { balance: number | null; payment_hold?: boolean | null }[]): number {
  return rows.filter((r) => needsPayment(r.balance, r.payment_hold)).length;
}

export interface ReupPackageOption {
  id: string;
  name: string;
  priceCents: number;
  sessionsGranted: number;
  billingType: "one_time" | "subscription";
  isActive: boolean;
}

// The package a client's re-up button buys: the one they bought last, else the one the coach assigned them (newest first).
// Anything inactive is skipped. No match means the client is told to message their coach.
export function chooseReupPackage(
  lastPurchasedIds: string[],
  assignedIds: string[],
  packages: ReupPackageOption[]
): ReupPackageOption | null {
  const byId = new Map(packages.filter((p) => p.isActive).map((p) => [p.id, p]));
  for (const id of lastPurchasedIds) {
    const p = byId.get(id);
    if (p) return p;
  }
  for (const id of assignedIds) {
    const p = byId.get(id);
    if (p) return p;
  }
  return null;
}

// "$420" / "$52.50"
export function formatPackagePrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

// A coach reminder to one client is limited so a client is never nagged: at most one every 3 days.
export const REMINDER_COOLDOWN_HOURS = 72;

export function reminderAllowed(lastNudgeAt: string | null | undefined, now: Date, cooldownHours: number = REMINDER_COOLDOWN_HOURS): boolean {
  if (!lastNudgeAt) return true;
  const last = new Date(lastNudgeAt).getTime();
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= cooldownHours * 3600000;
}

// ---- low balance alerts to the coach: once per crossing ---------------------------------------------------------------
// Tiers are 3 left, 1 left, and 0 or below. A tier alerts when the balance first falls into it, then stays quiet until the
// balance has gone back above 3 (a top-up) and fallen again. lastLevel is the tier already alerted (3, 1, 0) or null.
export type LowBalanceTier = 3 | 1 | 0;

export function tierForBalance(balance: number): LowBalanceTier | null {
  if (balance <= 0) return 0;
  if (balance === 1) return 1;
  if (balance <= 3) return 3;
  return null;
}

export function lowBalanceCrossing(
  balance: number,
  lastLevel: number | null | undefined
): { notify: LowBalanceTier | null; nextLevel: number | null } {
  const tier = tierForBalance(balance);
  // Back above the top tier: reset, so the next fall alerts again.
  if (tier === null) return { notify: null, nextLevel: null };
  // Falling into a lower tier than the last alert (3 -> 1 -> 0) alerts. Landing on the same tier stays quiet.
  if (lastLevel === null || lastLevel === undefined || tier < lastLevel) return { notify: tier, nextLevel: tier };
  // A top-up that still leaves the balance low: no alert now, but remember the higher tier so the next fall alerts again.
  if (tier > lastLevel) return { notify: null, nextLevel: tier };
  return { notify: null, nextLevel: lastLevel };
}
