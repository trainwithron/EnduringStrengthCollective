import { describe, it, expect } from "vitest";
import { ledgerTotals } from "./credit-ledger-totals";

describe("what was bought and what was used", () => {
  it("adds up grants and uses", () => {
    expect(
      ledgerTotals([
        { kind: "opening", amount: 2 },
        { kind: "purchased", amount: 10 },
        { kind: "delivered", amount: -3 },
        { kind: "booked", amount: -1 },
      ])
    ).toEqual({ bought: 12, done: 4 });
  });
  it("a refund gives a use back, and a cancelled booking nets to nothing", () => {
    expect(ledgerTotals([{ kind: "assigned", amount: 5 }, { kind: "booked", amount: -1 }, { kind: "refund", amount: 1 }])).toEqual({ bought: 5, done: 0 });
  });
  it("leaves out expired and waived entries, and a downward adjustment is not a use", () => {
    expect(ledgerTotals([{ kind: "assigned", amount: 8 }, { kind: "expired", amount: -3 }, { kind: "waived", amount: 0 }, { kind: "adjusted", amount: -1 }])).toEqual({ bought: 8, done: 0 });
  });
  it("a session already paid for but still ahead is not 'completed' yet", () => {
    const rows = [{ kind: "purchased", amount: 10 }, { kind: "delivered", amount: -2 }, { kind: "booked", amount: -3 }];
    expect(ledgerTotals(rows)).toEqual({ bought: 10, done: 5 });
    expect(ledgerTotals(rows, { prepaidAhead: 3 })).toEqual({ bought: 10, done: 2 });
    expect(ledgerTotals(rows, { prepaidAhead: 99 })).toEqual({ bought: 10, done: 0 });
  });
  it("is zero for no history and never negative", () => {
    expect(ledgerTotals([])).toEqual({ bought: 0, done: 0 });
    expect(ledgerTotals([{ kind: "refund", amount: 4 }])).toEqual({ bought: 0, done: 0 });
  });
});
