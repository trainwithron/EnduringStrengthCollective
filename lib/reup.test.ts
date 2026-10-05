import { describe, expect, it } from "vitest";
import {
  chooseReupPackage,
  coachBalanceLabel,
  countNeedingPayment,
  formatPackagePrice,
  lowBalanceCrossing,
  needsPayment,
  reminderAllowed,
  tierForBalance,
  type ReupPackageOption,
} from "@/lib/reup";

describe("needs payment", () => {
  it("zero and below need payment", () => {
    expect(needsPayment(0, false)).toBe(true);
    expect(needsPayment(-3, false)).toBe(true);
    expect(needsPayment(1, false)).toBe(false);
  });

  it("no balance row is not 'needs payment'", () => {
    expect(needsPayment(null, false)).toBe(false);
    expect(needsPayment(undefined, undefined)).toBe(false);
  });

  it("a client on hold is left out", () => {
    expect(needsPayment(-2, true)).toBe(false);
  });

  it("counts a roster", () => {
    expect(
      countNeedingPayment([
        { balance: 0 },
        { balance: -1, payment_hold: false },
        { balance: -1, payment_hold: true },
        { balance: 5 },
        { balance: null },
      ])
    ).toBe(2);
  });
});

describe("coach balance wording", () => {
  it("says owed for a negative balance", () => {
    expect(coachBalanceLabel(-2)).toBe("Owed 2");
    expect(coachBalanceLabel(0)).toBe("0 left");
    expect(coachBalanceLabel(4)).toBe("4 left");
    expect(coachBalanceLabel(null)).toBe("No sessions set up");
  });
});

describe("choosing the re-up package", () => {
  const pkg = (id: string, over: Partial<ReupPackageOption> = {}): ReupPackageOption => ({
    id,
    name: id,
    priceCents: 40000,
    sessionsGranted: 4,
    billingType: "one_time",
    isActive: true,
    ...over,
  });

  it("prefers the last one they bought", () => {
    expect(chooseReupPackage(["b", "a"], ["c"], [pkg("a"), pkg("b"), pkg("c")])?.id).toBe("b");
  });

  it("falls back to an assigned package", () => {
    expect(chooseReupPackage([], ["c"], [pkg("a"), pkg("c")])?.id).toBe("c");
  });

  it("skips an inactive package and moves to the next", () => {
    expect(chooseReupPackage(["b", "a"], [], [pkg("a"), pkg("b", { isActive: false })])?.id).toBe("a");
  });

  it("returns nothing when there is nothing to buy", () => {
    expect(chooseReupPackage([], [], [pkg("a")])).toBeNull();
    expect(chooseReupPackage(["x"], ["y"], [pkg("a")])).toBeNull();
  });

  it("formats prices", () => {
    expect(formatPackagePrice(40000)).toBe("$400");
    expect(formatPackagePrice(5250)).toBe("$52.50");
  });
});

describe("reminder cooldown", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("allows the first reminder", () => {
    expect(reminderAllowed(null, now)).toBe(true);
  });
  it("blocks a second within 72 hours and allows after", () => {
    expect(reminderAllowed("2026-10-08T13:00:00Z", now)).toBe(false);
    expect(reminderAllowed("2026-10-07T12:00:00Z", now)).toBe(true);
  });
});

describe("low balance: once per crossing", () => {
  it("maps balances to tiers", () => {
    expect(tierForBalance(5)).toBeNull();
    expect(tierForBalance(3)).toBe(3);
    expect(tierForBalance(2)).toBe(3);
    expect(tierForBalance(1)).toBe(1);
    expect(tierForBalance(0)).toBe(0);
    expect(tierForBalance(-4)).toBe(0);
  });

  it("alerts the first time a tier is reached", () => {
    expect(lowBalanceCrossing(3, null)).toEqual({ notify: 3, nextLevel: 3 });
    expect(lowBalanceCrossing(1, 3)).toEqual({ notify: 1, nextLevel: 1 });
    expect(lowBalanceCrossing(0, 1)).toEqual({ notify: 0, nextLevel: 0 });
  });

  it("stays quiet on a repeat of the same tier", () => {
    expect(lowBalanceCrossing(3, 3)).toEqual({ notify: null, nextLevel: 3 });
    expect(lowBalanceCrossing(0, 0)).toEqual({ notify: null, nextLevel: 0 });
    expect(lowBalanceCrossing(-2, 0)).toEqual({ notify: null, nextLevel: 0 });
  });

  it("a small top-up does not alert, but the next fall does", () => {
    const up = lowBalanceCrossing(2, 0);
    expect(up).toEqual({ notify: null, nextLevel: 3 });
    expect(lowBalanceCrossing(1, up.nextLevel)).toEqual({ notify: 1, nextLevel: 1 });
    expect(lowBalanceCrossing(0, 1)).toEqual({ notify: 0, nextLevel: 0 });
  });

  it("resets after a top-up and alerts again on the next fall", () => {
    const afterTopUp = lowBalanceCrossing(10, 0);
    expect(afterTopUp).toEqual({ notify: null, nextLevel: null });
    expect(lowBalanceCrossing(1, afterTopUp.nextLevel)).toEqual({ notify: 1, nextLevel: 1 });
  });

  it("skipping a tier still alerts", () => {
    expect(lowBalanceCrossing(0, null)).toEqual({ notify: 0, nextLevel: 0 });
  });
});
