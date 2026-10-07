import { describe, it, expect } from "vitest";
import { isCreditBalanceExpired, creditExpiryDate, creditExpiryWithHold } from "./credit-expiration";

describe("isCreditBalanceExpired", () => {
  it("never expires when credit_expiry_days is 0 (the default)", () => {
    expect(isCreditBalanceExpired("2026-01-01T00:00:00Z", 0, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("never expires when there's no grant on record", () => {
    expect(isCreditBalanceExpired(null, 30, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("is not expired before the cutoff", () => {
    expect(isCreditBalanceExpired("2026-01-01T00:00:00Z", 30, new Date("2026-01-15T00:00:00Z"))).toBe(false);
  });

  it("is expired exactly at the cutoff boundary", () => {
    expect(isCreditBalanceExpired("2026-01-01T00:00:00Z", 30, new Date("2026-01-31T00:00:00Z"))).toBe(true);
  });

  it("is not expired one millisecond before the cutoff", () => {
    expect(isCreditBalanceExpired("2026-01-01T00:00:00Z", 30, new Date("2026-01-30T23:59:59.999Z"))).toBe(false);
  });

  it("is expired well past the cutoff", () => {
    expect(isCreditBalanceExpired("2026-01-01T00:00:00Z", 30, new Date("2026-06-01T00:00:00Z"))).toBe(true);
  });
});

describe("creditExpiryDate", () => {
  it("returns null when credit_expiry_days is 0", () => {
    expect(creditExpiryDate("2026-01-01T00:00:00Z", 0)).toBeNull();
  });

  it("returns null when there's no grant on record", () => {
    expect(creditExpiryDate(null, 30)).toBeNull();
  });

  it("computes the real expiry date", () => {
    const date = creditExpiryDate("2026-01-01T00:00:00Z", 30);
    expect(date?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });
});

import { creditToExpire } from "./credit-expiration";

describe("creditToExpire", () => {
  it("expires only what is above booked-ahead and unmarked sessions", () => {
    expect(creditToExpire(5, 2, 1)).toBe(2);
    expect(creditToExpire(5, 0, 0)).toBe(5);
  });
  it("expires nothing when everything left is already spoken for", () => {
    expect(creditToExpire(3, 3, 0)).toBe(0);
    expect(creditToExpire(3, 2, 4)).toBe(0);
  });
  it("is never negative or above the balance, whatever it is given", () => {
    expect(creditToExpire(0, 0, 0)).toBe(0);
    expect(creditToExpire(4, -2, -1)).toBe(4);
  });
});

describe("creditExpiryWithHold: the date the nightly job will really start from", () => {
  const granted = "2026-01-01T00:00:00Z";
  it("is the normal expiry with no hold, and the later of the two with one", () => {
    const normal = new Date("2026-03-02T00:00:00Z"); // 60 days after the grant
    expect(creditExpiryWithHold(granted, 60, null)?.getTime()).toBe(normal.getTime());
    expect(creditExpiryWithHold(granted, 60, "2026-04-01T00:00:00Z")?.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(creditExpiryWithHold(granted, 60, "2026-02-01T00:00:00Z")?.getTime()).toBe(normal.getTime()); // an old hold changes nothing
  });
  it("is nothing when the coach has no expiry window or the client has no grant", () => {
    expect(creditExpiryWithHold(granted, 0, "2026-04-01T00:00:00Z")).toBeNull();
    expect(creditExpiryWithHold(null, 60, "2026-04-01T00:00:00Z")).toBeNull();
  });
});
