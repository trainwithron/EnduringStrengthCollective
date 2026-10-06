import { describe, it, expect } from "vitest";
import {
  buildCheckInDraft,
  daysUntil,
  expiringSoon,
  expiryDismissalKey,
  expiryWindowLine,
  holdUntilAfterExtension,
  isSnoozed,
  returningClient,
} from "./expiry-checkin";

const now = new Date("2026-10-06T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000).toISOString();

describe("expiringSoon", () => {
  const row = (over = {}) => ({ athleteId: "a", groupId: "g", balance: 9, lastGrantedAt: daysAgo(166), holdUntil: null as string | null, ...over });
  it("lists a client whose sessions expire inside the heads-up window, soonest first", () => {
    const rows = [row({ athleteId: "late", lastGrantedAt: daysAgo(150) }), row({ athleteId: "soon", lastGrantedAt: daysAgo(170) })];
    const out = expiringSoon(rows, 180, 30, now);
    expect(out.map((r) => r.athleteId)).toEqual(["soon", "late"]);
    expect(out[0].daysLeft).toBe(10);
  });
  it("says 14 days left when 14 days are left", () => {
    const out = expiringSoon([row({ lastGrantedAt: daysAgo(166) })], 180, 30, now);
    expect(out[0].daysLeft).toBe(14);
  });
  it("leaves out anyone with nothing left, outside the window, with no expiry window, or with expiry on hold", () => {
    expect(expiringSoon([row({ balance: 0 })], 180, 30, now)).toEqual([]);
    expect(expiringSoon([row({ lastGrantedAt: daysAgo(100) })], 180, 30, now)).toEqual([]);
    expect(expiringSoon([row()], 0, 30, now)).toEqual([]);
    expect(expiringSoon([row({ holdUntil: new Date(now.getTime() + 86400000).toISOString() })], 180, 30, now)).toEqual([]);
  });
  it("includes a client whose hold has run out", () => {
    expect(expiringSoon([row({ holdUntil: daysAgo(1) })], 180, 30, now)).toHaveLength(1);
  });
  it("leaves out a balance already past its date (the nightly job and the returning prompt cover that)", () => {
    expect(expiringSoon([row({ lastGrantedAt: daysAgo(200) })], 180, 30, now)).toEqual([]);
  });
});

describe("extension and drafts", () => {
  it("extends from the date the sessions were due to expire, or from now if that has passed", () => {
    const due = new Date(now.getTime() + 10 * 86400000);
    expect(holdUntilAfterExtension(due, 30, now).getTime()).toBe(due.getTime() + 30 * 86400000);
    const past = new Date(now.getTime() - 5 * 86400000);
    expect(holdUntilAfterExtension(past, 30, now).getTime()).toBe(now.getTime() + 30 * 86400000);
  });
  it("drafts a warm check-in with the real numbers and no mention of money", () => {
    const text = buildCheckInDraft({ firstName: "Sam", balance: 9, daysLeft: 14 });
    expect(text).toContain("Hi Sam");
    expect(text).toContain("9 sessions");
    expect(text).toContain("14 days");
    expect(text).not.toMatch(/pay|money|refund|lose/i);
    expect(buildCheckInDraft({ firstName: "", balance: 1, daysLeft: 1 })).toContain("1 session left");
  });
  it("rounds days up", () => {
    expect(daysUntil(new Date(now.getTime() + 3600000), now)).toBe(1);
  });
});

describe("returning client", () => {
  const expiredOn = new Date("2026-01-10T00:00:00Z");
  it("surfaces a client who trained after their sessions expired", () => {
    const r = returningClient({ athleteId: "a", groupId: "g", expiredOn, reinstatable: 9, lastActivityAt: new Date("2026-10-01T00:00:00Z"), now });
    expect(r?.reinstatable).toBe(9);
    expect(r?.monthsAway).toBe(9);
  });
  it("does not surface when nothing is left to give back, there was no activity since, or nothing expired", () => {
    expect(returningClient({ athleteId: "a", groupId: "g", expiredOn, reinstatable: 0, lastActivityAt: new Date("2026-10-01"), now })).toBeNull();
    expect(returningClient({ athleteId: "a", groupId: "g", expiredOn, reinstatable: 9, lastActivityAt: new Date("2026-01-01"), now })).toBeNull();
    expect(returningClient({ athleteId: "a", groupId: "g", expiredOn: null, reinstatable: 9, lastActivityAt: new Date("2026-10-01"), now })).toBeNull();
  });
});

describe("snooze, keys and the client's line", () => {
  it("stays away for 14 days after Not now", () => {
    expect(isSnoozed(daysAgo(3), now)).toBe(true);
    expect(isSnoozed(daysAgo(20), now)).toBe(false);
    expect(isSnoozed(null, now)).toBe(false);
  });
  it("keys soon and returning prompts separately", () => {
    expect(expiryDismissalKey("a", "g", "soon")).not.toBe(expiryDismissalKey("a", "g", "returning"));
  });
  it("tells a client the window in plain words, or nothing when sessions do not expire", () => {
    expect(expiryWindowLine(180)).toContain("180 days after your last purchase");
    expect(expiryWindowLine(0)).toBeNull();
  });
});
