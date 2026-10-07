// What a client bought and what has been used, from the credit history (session_credit_ledger), for the sentence "12 sessions bought, 4 completed, ...".
// Bought: sessions added by the coach or a purchase (assigned, purchased, the opening balance, an adjustment up). Used: delivered, a prepaid booking and refunds
// (a refund is a negative use). Expired and waived entries are neither. A prepaid session still ahead of them took its session up front but has not happened:
// `prepaidAhead` takes it back out of "completed".

const BOUGHT_KINDS = new Set(["assigned", "purchased", "opening", "adjusted"]);
const USED_KINDS = new Set(["delivered", "booked", "refund"]);

export function ledgerTotals(rows: { kind: string; amount: number }[], opts: { prepaidAhead?: number } = {}): { bought: number; done: number } {
  let bought = 0;
  let used = 0;
  for (const r of rows) {
    if (BOUGHT_KINDS.has(r.kind) && r.amount > 0) bought += r.amount;
    else if (USED_KINDS.has(r.kind)) used -= r.amount;
  }
  return { bought, done: Math.max(0, used - Math.max(0, opts.prepaidAhead ?? 0)) };
}
