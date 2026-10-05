import { balanceLabel, formatLedgerAmount, lastReupDate, ledgerKindLabel, type LedgerEntry } from "@/lib/session-ledger";

// A client's session history in one place: what was assigned or bought and when, what was delivered since, anything
// not charged, and where the balance stands. Quiet by design: a short list, no extra screen.
export function SessionLedgerList({ balance, entries }: { balance: number; entries: LedgerEntry[] }) {
  const lastReup = lastReupDate(entries);
  return (
    <div>
      <p className="font-body text-sm text-chalk">
        {balanceLabel(balance)}
        {lastReup && (
          <span className="text-steel">
            {" "}
            · last re-up {new Date(lastReup).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        )}
      </p>
      {entries.length === 0 ? (
        <p className="font-body text-xs text-steel mt-2">Nothing recorded yet. Sessions you assign or deliver will show here.</p>
      ) : (
        <ul className="mt-2 divide-y divide-steel/15">
          {entries.map((e) => (
            <li key={e.id} className="py-1.5 flex items-baseline justify-between gap-3">
              <span className="font-body text-xs text-steel min-w-0">
                {new Date(e.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {" · "}
                <span className="text-chalk">{ledgerKindLabel(e.kind)}</span>
                {e.note ? ` — ${e.note}` : ""}
              </span>
              <span className="font-body text-xs text-chalk tabular-nums shrink-0">
                {formatLedgerAmount(e.amount)} <span className="text-steel">→ {e.balanceAfter}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
