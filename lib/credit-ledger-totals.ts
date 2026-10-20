// What the CURRENT package holds, from the credit history (session_credit_ledger), for the sentence "12 sessions bought, 3 completed, 9 left" (Ron, Oct 19: once a package is used up he
// does not need the lifetime figure, "I don't need to see if they've bought 138 packages over six months"; he needs this package).
//
// The rule (FIX 3, Ron, Oct 19: "Add sessions" makes one package):
//   - The current package starts at the MOST RECENT real grant: sessions assigned ("Add sessions"), purchased, or the opening balance. A new grant restarts the counts; what was still
//     unused when it arrived rolls in, said plainly as "carried over" (the grant row records the balance after it, so the balance before it is balance_after - amount).
//   - An adjustment with no session attached, after that start, RESIZES the current package (a +1 tap adds one to it, a balance set down takes it off), so bought, completed and left
//     always add up. An adjustment tied to a session (a late change that was charged) is a session USED.
//   - Completed = sessions used since that grant: delivered, a prepaid booking, refunds (a refund is a negative use), and charged adjustments. An expiry and a waived entry are neither.
//     A prepaid session still ahead took its session up front but has not happened: `prepaidAhead` takes it back out of "completed".
//   - No real grant in the history (only adjustments, which is how every early client was recorded: one +1 tap at a time): there is no package, bought is 0, and the sentence says only
//     where things stand now ("9 left"), never a made-up "bought".

const GRANT_KINDS = new Set(["assigned", "purchased", "opening"]);
const USED_KINDS = new Set(["delivered", "booked", "refund"]);

export interface LedgerRow {
  kind: string;
  amount: number;
  // The balance right after this entry. Optional: without it nothing is treated as carried over.
  balance_after?: number | null;
  // The session an entry is about (a charged late change is an adjustment tied to its booking).
  booking_id?: string | null;
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
    if (GRANT_KINDS.has(rows[i].kind) && rows[i].amount > 0) start = i;
  }
  if (start < 0) return { bought: 0, done: 0, carriedOver: 0 };
  const grant = rows[start];
  const before = typeof grant.balance_after === "number" ? grant.balance_after - grant.amount : 0;
  const carriedOver = Math.max(0, before);
  let bought = grant.amount + carriedOver;
  let used = 0;
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i];
    if (USED_KINDS.has(r.kind) || (r.kind === "adjusted" && r.booking_id)) used -= r.amount;
    else if (r.kind === "adjusted") bought += r.amount;
  }
  return { bought: Math.max(0, bought), done: Math.max(0, used - Math.max(0, opts.prepaidAhead ?? 0)), carriedOver };
}
