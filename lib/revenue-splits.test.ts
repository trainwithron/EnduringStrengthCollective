import { describe, it, expect } from "vitest";
import { computeRevenueSplit, formatSplitCents } from "./revenue-splits";

describe("computeRevenueSplit", () => {
  it("takes the platform fee off the top, then splits the remainder by coach share", () => {
    // $1000 total, 10% platform fee -> $900 remainder. Owner keeps 100%.
    const result = computeRevenueSplit(100000, 10, [
      { profileId: "owner", fullName: "Coach Ron", role: "owner", revenueSharePct: 100 },
    ]);
    expect(result.platformFeeCents).toBe(10000);
    expect(result.remainderCents).toBe(90000);
    expect(result.coachShares[0].amountCents).toBe(90000);
    expect(result.unallocatedCents).toBe(0);
  });

  it("splits the remainder across multiple coaches by their own percentages", () => {
    const result = computeRevenueSplit(100000, 10, [
      { profileId: "owner", fullName: "Coach Ron", role: "owner", revenueSharePct: 60 },
      { profileId: "jordan", fullName: "Jordan Coach", role: "coach", revenueSharePct: 40 },
    ]);
    expect(result.remainderCents).toBe(90000);
    expect(result.coachShares[0].amountCents).toBe(54000);
    expect(result.coachShares[1].amountCents).toBe(36000);
    expect(result.unallocatedCents).toBe(0);
  });

  it("reports unallocated cents when shares don't add up to 100%", () => {
    const result = computeRevenueSplit(100000, 0, [
      { profileId: "jordan", fullName: "Jordan Coach", role: "coach", revenueSharePct: 40 },
    ]);
    // 100000 remainder (no platform fee), only 40% allocated -> 40000 assigned, 60000 unallocated.
    expect(result.coachShares[0].amountCents).toBe(40000);
    expect(result.unallocatedCents).toBe(60000);
  });

  it("handles zero revenue without dividing by zero or erroring", () => {
    const result = computeRevenueSplit(0, 10, [
      { profileId: "owner", fullName: "Coach Ron", role: "owner", revenueSharePct: 100 },
    ]);
    expect(result.platformFeeCents).toBe(0);
    expect(result.coachShares[0].amountCents).toBe(0);
  });

  it("handles no coaches configured at all", () => {
    const result = computeRevenueSplit(50000, 10, []);
    expect(result.platformFeeCents).toBe(5000);
    expect(result.remainderCents).toBe(45000);
    expect(result.coachShares).toEqual([]);
    expect(result.unallocatedCents).toBe(45000);
  });
});

describe("formatSplitCents", () => {
  it("formats cents as a dollar string", () => {
    expect(formatSplitCents(90000)).toBe("$900");
    expect(formatSplitCents(5000)).toBe("$50");
  });
});
