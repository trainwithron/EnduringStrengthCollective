import { describe, expect, it } from "vitest";
import { balanceLabel, formatLedgerAmount, lastReupDate, ledgerKindLabel, type LedgerEntry } from "./session-ledger";

const entry = (kind: LedgerEntry["kind"], amount: number, createdAt: string): LedgerEntry => ({
  id: createdAt + kind,
  kind,
  amount,
  balanceAfter: 0,
  note: null,
  createdAt,
});

describe("session ledger helpers", () => {
  it("reads a negative balance as owed", () => {
    expect(balanceLabel(-1)).toBe("Owed 1 session");
    expect(balanceLabel(-3)).toBe("Owed 3 sessions");
    expect(balanceLabel(0)).toBe("0 sessions");
    expect(balanceLabel(12)).toBe("12 sessions");
  });

  it("formats signed amounts", () => {
    expect(formatLedgerAmount(12)).toBe("+12");
    expect(formatLedgerAmount(-1)).toBe("-1");
    expect(formatLedgerAmount(0)).toBe("0");
  });

  it("finds the last re-up among assigned and purchased entries only", () => {
    const entries = [
      entry("delivered", -1, "2026-10-07T10:00:00Z"),
      entry("assigned", 12, "2026-09-03T10:00:00Z"),
      entry("purchased", 10, "2026-09-20T10:00:00Z"),
      entry("refund", 1, "2026-10-09T10:00:00Z"),
    ];
    expect(lastReupDate(entries)).toBe("2026-09-20T10:00:00Z");
    expect(lastReupDate([entry("delivered", -1, "2026-10-07T10:00:00Z")])).toBeNull();
  });

  it("labels every kind", () => {
    expect(ledgerKindLabel("delivered")).toBe("Delivered");
    expect(ledgerKindLabel("waived")).toBe("Not charged");
  });
});
