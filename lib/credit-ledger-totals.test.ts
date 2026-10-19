import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { currentPackageTotals, type LedgerRow } from "./credit-ledger-totals";
import { buildCreditPicture } from "./credit-picture";
import { coachCreditSentence } from "./credit-sentence";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// A ledger built the way the database writes it: each row carries the balance right after it.
function ledger(steps: { kind: string; amount: number }[], start = 0): LedgerRow[] {
  let balance = start;
  return steps.map((s) => {
    balance += s.amount;
    return { kind: s.kind, amount: s.amount, balance_after: balance };
  });
}
const used = (n: number) => Array.from({ length: n }, () => ({ kind: "delivered", amount: -1 }));
const sentenceFor = (rows: LedgerRow[], balance: number, booked = 0, prepaidAhead = 0) => {
  const t = currentPackageTotals(rows, { prepaidAhead });
  return coachCreditSentence(buildCreditPicture({ balance, booked, toMark: 0, bought: t.bought, done: t.done, carriedOver: t.carriedOver }), "Hewan");
};

// Ron, Oct 19: "I don't need to see if they've bought 138 packages over six months. I need to see: 12 bought, 3 completed, 9 left, if that's out of THIS package."
describe("the current package, not the lifetime totals", () => {
  it("three 15-session packages over six months (138 sessions delivered over the years): only the newest one is counted", () => {
    const rows = ledger([
      { kind: "purchased", amount: 15 }, ...used(15),
      { kind: "purchased", amount: 15 }, ...used(15),
      { kind: "purchased", amount: 15 }, ...used(3),
    ]);
    // plus the 138 earlier sessions in the same history
    const lifetime = ledger([{ kind: "purchased", amount: 138 }, ...used(138), ...rows.map((r) => ({ kind: r.kind, amount: r.amount }))]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 15, done: 3, carriedOver: 0 });
    expect(currentPackageTotals(lifetime)).toEqual({ bought: 15, done: 3, carriedOver: 0 });
    expect(sentenceFor(lifetime, 12)).toBe("15 sessions bought, 3 completed, and 12 left: none booked yet.");
  });
  it("a current package of 12: 12 bought, 3 completed, 9 left", () => {
    const rows = ledger([{ kind: "purchased", amount: 15 }, ...used(15), { kind: "adjusted", amount: 12 }, ...used(3)]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 12, done: 3, carriedOver: 0 });
    expect(sentenceFor(rows, 9)).toBe("12 sessions bought, 3 completed, and 9 left: none booked yet.");
    expect(sentenceFor(rows, 9, 4)).toBe("12 sessions bought, 3 completed, and 9 left: 4 booked and 5 still to schedule.");
  });
  it("a used-up package reads as completed, and says nothing of earlier packages", () => {
    const rows = ledger([{ kind: "purchased", amount: 15 }, ...used(15), { kind: "purchased", amount: 10 }, ...used(10)]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 10, done: 10, carriedOver: 0 });
    expect(sentenceFor(rows, 0)).toBe("10 sessions bought, all 10 completed.");
  });
  it("a new package restarts the counts, and what was left from the old one is said to be carried over", () => {
    const rows = ledger([{ kind: "purchased", amount: 10 }, ...used(8), { kind: "purchased", amount: 15 }, ...used(3)]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 17, done: 3, carriedOver: 2 });
    expect(sentenceFor(rows, 14)).toBe("17 sessions bought (including 2 carried over), 3 completed, and 14 left: none booked yet.");
  });
  it("a one-off manual credit on a used-up package is a package of its own", () => {
    const rows = ledger([{ kind: "purchased", amount: 15 }, ...used(15), { kind: "adjusted", amount: 1 }]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 1, done: 0, carriedOver: 0 });
    expect(sentenceFor(rows, 1)).toBe("1 session bought, and 1 left: none booked yet.");
  });
  it("a one-off manual credit on top of sessions still unused says how many were already there", () => {
    const rows = ledger([{ kind: "purchased", amount: 15 }, ...used(7), { kind: "adjusted", amount: 1 }]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 9, done: 0, carriedOver: 8 });
    expect(sentenceFor(rows, 9)).toBe("9 sessions bought (including 8 carried over), and 9 left: none booked yet.");
  });
  it("corrections are neither bought nor used: a balance set down does not start a package or count as completed", () => {
    const rows = ledger([{ kind: "purchased", amount: 15 }, ...used(3), { kind: "adjusted", amount: -2 }, { kind: "expired", amount: -1 }, { kind: "waived", amount: 0 }]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 15, done: 3, carriedOver: 0 });
  });
  it("a refund gives a use back; a prepaid session still ahead is not completed yet", () => {
    expect(currentPackageTotals(ledger([{ kind: "assigned", amount: 5 }, { kind: "booked", amount: -1 }, { kind: "refund", amount: 1 }]))).toEqual({ bought: 5, done: 0, carriedOver: 0 });
    const rows = ledger([{ kind: "purchased", amount: 10 }, { kind: "delivered", amount: -2 }, { kind: "booked", amount: -3 }]);
    expect(currentPackageTotals(rows, { prepaidAhead: 3 })).toEqual({ bought: 10, done: 2, carriedOver: 0 });
    expect(currentPackageTotals(rows, { prepaidAhead: 99 }).done).toBe(0);
  });
  it("the opening balance counts as a package; a balance owed before a grant is not 'carried over'", () => {
    expect(currentPackageTotals(ledger([{ kind: "opening", amount: 6 }, ...used(2)]))).toEqual({ bought: 6, done: 2, carriedOver: 0 });
    expect(currentPackageTotals(ledger([{ kind: "purchased", amount: 15 }], -2))).toEqual({ bought: 15, done: 0, carriedOver: 0 });
  });
  it("no history, or a history with no grant at all, gives no package (the sentence then says where things stand now)", () => {
    expect(currentPackageTotals([])).toEqual({ bought: 0, done: 0, carriedOver: 0 });
    expect(currentPackageTotals(ledger([{ kind: "delivered", amount: -1 }]))).toEqual({ bought: 0, done: 0, carriedOver: 0 });
    const t = currentPackageTotals([]);
    expect(coachCreditSentence(buildCreditPicture({ balance: 4, booked: 0, toMark: 0, bought: t.bought, done: t.done, carriedOver: t.carriedOver }), "Hewan")).toBe("Hewan has 4 sessions left.");
  });
  it("the scheduling panel and the client profile both read the history oldest first, with the balance after each entry", () => {
    for (const f of ["components/coach/desktop/client-schedule-panel.tsx", "app/(coach)/groups/[groupId]/athletes/[athleteId]/page.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("currentPackageTotals(");
      expect(src, f).toContain('.select("id, kind, amount, balance_after")');
      expect(src, f).toContain('.order("created_at", { ascending: true }).order("id", { ascending: true })');
      expect(src, f).not.toContain("ledgerTotals");
    }
  });
});
