// What the CURRENT package holds, from the credit history (session_credit_ledger), for the sentence "12 sessions bought, 3 completed, 9 left" (Ron, Oct 19: once a package is used up he
// does not need the lifetime figure, "I don't need to see if they've bought 138 packages over six months"; he needs this package).
//
// The rule: the current package starts at the MOST RECENT grant of sessions: assigned, purchased, the opening balance, or an adjustment up (that is how most packages are recorded, as
// "Balance set from 0 to 10"). A new grant restarts the counts. What was still unused when it arrived rolls in, said plainly as "carried over" (the grant row records the balance after it, so
// the balance before it is balance_after - amount). Completed = sessions used since that grant: delivered, a prepaid booking, refunds (a refund is a negative use). A downward
// adjustment, an expiry and a waived entry are corrections, neither bought nor used. A prepaid session still ahead took its session up front but has not happened: `prepaidAhead`
// takes it back out of "completed". A one-off manual credit is simply the newest grant: on a used-up package it reads "1 bought, 0 completed, 1 left"; on top of 8 left it reads
// "9 bought (including 8 carried over), 0 completed, 9 left".
// No grant in the history at all (only uses): bought is 0 and the sentence falls back to "where things stand now".

const BOUGHT_KINDS = new Set(["assigned", "purchased", "opening", "adjusted"]);
const USED_KINDS = new Set(["delivered", "booked", "refund"]);

export interface LedgerRow {
  kind: string;
  amount: number;
  // The balance right after this entry. Optional: without it nothing is treated as carried over.
  balance_after?: number | null;
}

export interface PackageTotals {
  bought: number;
  done: number;
  carriedOver: number;
}

// `rows` must be oldest first (order by created_at, then id).
export function currentPackageTotals(rows: LedgerRow[], opts: { prepaidAhead?: number } = {}): PackageTotals {
  let start = -1;
  for (let i = 0; i < rows.length; i++) {
    if (BOUGHT_KINDS.has(rows[i].kind) && rows[i].amount > 0) start = i;
  }
  if (start < 0) return { bought: 0, done: 0, carriedOver: 0 };
  const grant = rows[start];
  const before = typeof grant.balance_after === "number" ? grant.balance_after - grant.amount : 0;
  const carriedOver = Math.max(0, before);
  let used = 0;
  for (let i = start + 1; i < rows.length; i++) {
    if (USED_KINDS.has(rows[i].kind)) used -= rows[i].amount;
  }
  return { bought: grant.amount + carriedOver, done: Math.max(0, used - Math.max(0, opts.prepaidAhead ?? 0)), carriedOver };
}
