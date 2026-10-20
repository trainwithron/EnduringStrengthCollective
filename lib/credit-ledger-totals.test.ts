import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { currentPackageTotals, type LedgerRow } from "./credit-ledger-totals";
import { buildCreditPicture } from "./credit-picture";
import { coachCreditSentence } from "./credit-sentence";

const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// A ledger built the way the database writes it: each row carries the balance right after it.
function ledger(steps: { kind: string; amount: number; booking_id?: string }[], start = 0): LedgerRow[] {
  let balance = start;
  return steps.map((s) => {
    balance += s.amount;
    return { kind: s.kind, amount: s.amount, balance_after: balance, ...(s.booking_id ? { booking_id: s.booking_id } : {}) };
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
  it("a current package of 12 (Add sessions): 12 bought, 3 completed, 9 left", () => {
    const rows = ledger([{ kind: "purchased", amount: 15 }, ...used(15), { kind: "assigned", amount: 12 }, ...used(3)]);
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
  it("a +1 tap after a package resizes that package (it does not start a new one), so bought, completed and left add up", () => {
    const rows = ledger([{ kind: "purchased", amount: 15 }, ...used(15), { kind: "adjusted", amount: 1 }]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 16, done: 15, carriedOver: 0 });
    expect(sentenceFor(rows, 1)).toBe("16 sessions bought, 15 completed, and 1 left: none booked yet.");
    const unused = ledger([{ kind: "purchased", amount: 15 }, ...used(7), { kind: "adjusted", amount: 1 }]);
    expect(currentPackageTotals(unused)).toEqual({ bought: 16, done: 7, carriedOver: 0 });
    expect(sentenceFor(unused, 9)).toBe("16 sessions bought, 7 completed, and 9 left: none booked yet.");
  });
  it("a balance set down takes it off the package; an expiry and a waived entry are neither bought nor used", () => {
    const rows = ledger([{ kind: "purchased", amount: 15 }, ...used(3), { kind: "adjusted", amount: -2 }, { kind: "expired", amount: -1 }, { kind: "waived", amount: 0 }]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 13, done: 3, carriedOver: 0 });
  });
  it("only +1 taps (every early client, e.g. Oliver Bourne): no package, so no 'bought', just what is left", () => {
    const oliver = ledger([...Array.from({ length: 12 }, () => ({ kind: "adjusted", amount: 1 })), ...used(1)]);
    expect(currentPackageTotals(oliver)).toEqual({ bought: 0, done: 0, carriedOver: 0 });
    expect(sentenceFor(oliver, 11)).toBe("Hewan has 11 sessions left: none booked yet.".replace(": none booked yet", ""));
  });
  it("a charged late change (an adjustment tied to its session) is a session used", () => {
    const rows = ledger([{ kind: "assigned", amount: 10 }, ...used(2), { kind: "adjusted", amount: -1, booking_id: "b1" }]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 10, done: 3, carriedOver: 0 });
    expect(sentenceFor(rows, 7)).toBe("10 sessions bought, 3 completed, and 7 left: none booked yet.");
  });
  it("Add sessions on top of unused sessions says how many were carried over", () => {
    const rows = ledger([{ kind: "assigned", amount: 10 }, ...used(8), { kind: "assigned", amount: 10 }, ...used(1)]);
    expect(currentPackageTotals(rows)).toEqual({ bought: 12, done: 1, carriedOver: 2 });
    expect(sentenceFor(rows, 11)).toBe("12 sessions bought (including 2 carried over), 1 completed, and 11 left: none booked yet.");
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
      expect(src, f).toContain('.select("id, kind, amount, balance_after, booking_id")');
      expect(src, f).toContain('.order("created_at", { ascending: true }).order("id", { ascending: true })');
      expect(src, f).not.toContain("ledgerTotals");
    }
  });
});
