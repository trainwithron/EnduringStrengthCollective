import { describe, expect, it } from "vitest";
import { computeQuietTier } from "./quiet-client-tier";

// Jan 4 2026 is a Sunday; trainingDays [1,3,5] = Mon/Wed/Fri.
const LAST_LOGGED = new Date(2026, 0, 4);

describe("computeQuietTier — never logged", () => {
  it("is immediately strong when the athlete has never logged at all", () => {
    expect(computeQuietTier({ lastLoggedAt: null, now: new Date(2026, 0, 5), trainingDays: [1, 3, 5] })).toBe("strong");
  });
});

describe("computeQuietTier — freeform fallback (no schedule)", () => {
  it("is none just under the 7-day mild threshold", () => {
    const now = new Date(2026, 0, 4 + 6);
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now, trainingDays: null })).toBe("none");
  });
  it("is mild exactly at the 7-day threshold", () => {
    const now = new Date(2026, 0, 4 + 7);
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now, trainingDays: [] })).toBe("mild");
  });
  it("is mild just under the 14-day strong threshold", () => {
    const now = new Date(2026, 0, 4 + 13);
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now, trainingDays: null })).toBe("mild");
  });
  it("is strong exactly at the 14-day threshold", () => {
    const now = new Date(2026, 0, 4 + 14);
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now, trainingDays: null })).toBe("strong");
  });
});

describe("computeQuietTier — frequency-normalized (scheduled program)", () => {
  const trainingDays = [1, 3, 5]; // Mon/Wed/Fri, 3/week

  it("is none with only 2 of 3 weekly sessions missed", () => {
    const now = new Date(2026, 0, 8); // Thu — Mon+Wed missed = 2
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now, trainingDays })).toBe("none");
  });

  it("is mild exactly at one week's worth (3) missed", () => {
    const now = new Date(2026, 0, 9); // Fri — Mon+Wed+Fri missed = 3
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now, trainingDays })).toBe("mild");
  });

  it("is still mild just under two weeks' worth (5) missed", () => {
    const now = new Date(2026, 0, 15); // Thu — Mon,Wed,Fri,Mon,Wed missed = 5
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now, trainingDays })).toBe("mild");
  });

  it("is strong exactly at two weeks' worth (6) missed", () => {
    const now = new Date(2026, 0, 16); // Fri — 6 scheduled days missed
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now, trainingDays })).toBe("strong");
  });

  it("normalizes correctly for a lighter 1x/week schedule", () => {
    const oneDayWeek = [1]; // Monday only
    // Mild after missing just 1 Monday (one week's worth for this client)
    const mildNow = new Date(2026, 0, 5); // the first Monday after last logged
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now: mildNow, trainingDays: oneDayWeek })).toBe("mild");
    // Strong after missing 2 Mondays
    const strongNow = new Date(2026, 0, 12); // the second Monday after that
    expect(computeQuietTier({ lastLoggedAt: LAST_LOGGED, now: strongNow, trainingDays: oneDayWeek })).toBe("strong");
  });
});

describe("a new client who has not started is not 'gone quiet'", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);
  it("is not flagged within the first two weeks of being added", () => {
    expect(computeQuietTier({ lastLoggedAt: null, now, trainingDays: null, addedAt: daysAgo(3), signedIn: true })).toBe("none");
    expect(computeQuietTier({ lastLoggedAt: null, now, trainingDays: null, addedAt: daysAgo(13), signedIn: true })).toBe("none");
  });
  it("is flagged after two weeks if they signed in and still have not started", () => {
    expect(computeQuietTier({ lastLoggedAt: null, now, trainingDays: null, addedAt: daysAgo(20), signedIn: true })).toBe("strong");
  });
  it("is given longer when they have not signed in yet", () => {
    expect(computeQuietTier({ lastLoggedAt: null, now, trainingDays: null, addedAt: daysAgo(30), signedIn: false })).toBe("none");
    expect(computeQuietTier({ lastLoggedAt: null, now, trainingDays: null, addedAt: daysAgo(60), signedIn: false })).toBe("strong");
  });
  it("keeps the old behavior when the caller does not know when they were added", () => {
    expect(computeQuietTier({ lastLoggedAt: null, now, trainingDays: null })).toBe("strong");
  });
  it("does not change anything for a client who has logged", () => {
    expect(computeQuietTier({ lastLoggedAt: daysAgo(20), now, trainingDays: null, addedAt: daysAgo(40), signedIn: true })).toBe("strong");
  });
});
