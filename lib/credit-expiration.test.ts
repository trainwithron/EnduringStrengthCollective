import { describe, it, expect } from "vitest";
import { isCreditBalanceExpired, creditExpiryDate } from "./credit-expiration";

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
