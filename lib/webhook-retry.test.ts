import { describe, it, expect } from "vitest";
import { backoffMinutesForAttempt, isDeliveryDueForRetry, MAX_WEBHOOK_ATTEMPTS } from "./webhook-retry";

describe("backoffMinutesForAttempt", () => {
  it("doubles the wait each attempt, starting at 1 minute", () => {
    expect(backoffMinutesForAttempt(0)).toBe(1);
    expect(backoffMinutesForAttempt(1)).toBe(2);
    expect(backoffMinutesForAttempt(2)).toBe(4);
    expect(backoffMinutesForAttempt(3)).toBe(8);
    expect(backoffMinutesForAttempt(4)).toBe(16);
  });
});

describe("isDeliveryDueForRetry", () => {
  const now = new Date("2026-01-01T12:00:00Z");

  it("is not due before the backoff window has elapsed", () => {
    const lastAttempted = new Date("2026-01-01T11:59:30Z"); // 30s ago, attempt 0 needs 1min
    expect(isDeliveryDueForRetry(0, lastAttempted, now)).toBe(false);
  });

  it("is due once the backoff window has elapsed", () => {
    const lastAttempted = new Date("2026-01-01T11:58:00Z"); // 2min ago, attempt 0 needs 1min
    expect(isDeliveryDueForRetry(0, lastAttempted, now)).toBe(true);
  });

  it("is due exactly at the boundary", () => {
    const lastAttempted = new Date("2026-01-01T11:59:00Z"); // exactly 1min ago
    expect(isDeliveryDueForRetry(0, lastAttempted, now)).toBe(true);
  });

  it("requires a longer wait at a higher attempt count", () => {
    const lastAttempted = new Date("2026-01-01T11:58:00Z"); // 2min ago, attempt 2 needs 4min
    expect(isDeliveryDueForRetry(2, lastAttempted, now)).toBe(false);
  });

  it("never retries once the max attempt count is reached", () => {
    const longAgo = new Date("2026-01-01T00:00:00Z");
    expect(isDeliveryDueForRetry(MAX_WEBHOOK_ATTEMPTS, longAgo, now)).toBe(false);
  });
});
