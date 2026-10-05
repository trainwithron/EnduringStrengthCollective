// The session ledger on a client's profile: what each entry says, and the two summary lines above it.
export type LedgerKind = "assigned" | "purchased" | "booked" | "delivered" | "waived" | "refund" | "adjusted" | "opening" | "expired";

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  amount: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<LedgerKind, string> = {
  assigned: "Assigned",
  purchased: "Purchased",
  booked: "Booked by client",
  delivered: "Delivered",
  waived: "Not charged",
  refund: "Given back",
  adjusted: "Adjusted",
  opening: "Starting balance",
  expired: "Expired",
};

export function ledgerKindLabel(kind: LedgerKind): string {
  return KIND_LABEL[kind] ?? "Adjusted";
}

// "+12", "-1", "0".
export function formatLedgerAmount(amount: number): string {
  if (amount > 0) return `+${amount}`;
  return String(amount);
}

// A negative balance means the client has had sessions that have not been paid for yet.
export function balanceLabel(balance: number): string {
  if (balance < 0) return `Owed ${Math.abs(balance)} session${Math.abs(balance) === 1 ? "" : "s"}`;
  return `${balance} session${balance === 1 ? "" : "s"}`;
}

// The most recent entry that put sessions on the account (a re-up), or null if none.
export function lastReupDate(entries: LedgerEntry[]): string | null {
  const reups = entries.filter((e) => (e.kind === "assigned" || e.kind === "purchased") && e.amount > 0);
  if (reups.length === 0) return null;
  return reups.reduce((latest, e) => (e.createdAt > latest ? e.createdAt : latest), reups[0].createdAt);
}

// What a booking has cost the client so far: delivered entries (negative) plus any refunds already returned for it.
// undo_booking_attended (migration 0248) refunds exactly this and no more, so settle, undo, settle, undo can never
// mint credits and cancel then undo returns nothing twice. Returns 0 when nothing is outstanding.
export function outstandingForBooking(entries: { kind: LedgerKind; amount: number; bookingId: string | null }[], bookingId: string): number {
  const net = entries
    .filter((e) => e.bookingId === bookingId && (e.kind === "delivered" || e.kind === "refund"))
    .reduce((sum, e) => sum + e.amount, 0);
  return Math.max(0, -net);
}
