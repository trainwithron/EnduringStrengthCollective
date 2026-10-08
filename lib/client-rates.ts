// What each client pays (the coach's manual monthly rate) is read from client_billing_rates, a SEPARATE query from the roster: if that table is not there yet (the database step has
// not been pasted), or the read fails, the roster must still show and the rates are simply empty. Every reader goes through this so that holds everywhere.

export interface RateRow {
  membership_id: string;
  monthly_rate: number | string | null;
}

// membership id -> monthly rate. A null/undefined/failed read gives an empty map; a row with no usable number is left out.
export function ratesByMembership(rows: RateRow[] | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows ?? []) {
    if (r?.monthly_rate == null || r.monthly_rate === "") continue;
    const n = Number(r.monthly_rate);
    if (Number.isFinite(n) && n >= 0) out.set(r.membership_id, n);
  }
  return out;
}
