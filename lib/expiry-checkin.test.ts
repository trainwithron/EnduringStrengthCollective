import { describe, it, expect } from "vitest";
import {
  buildCheckInDraft,
  daysUntil,
  expiringSoon,
  expiryDismissalKey,
  expiryFinalKey,
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
  it("leaves out anyone with nothing left, outside the window, or with no expiry window", () => {
    expect(expiringSoon([row({ balance: 0 })], 180, 30, now)).toEqual([]);
    expect(expiringSoon([row({ lastGrantedAt: daysAgo(100) })], 180, 30, now)).toEqual([]);
    expect(expiringSoon([row()], 0, 30, now)).toEqual([]);
  });
  const inDays = (n: number) => new Date(now.getTime() + n * 86400000).toISOString();
  it("leaves out a client whose expiry is held until well after the heads-up window", () => {
    expect(expiringSoon([row({ holdUntil: inDays(60) })], 180, 30, now)).toEqual([]);
    // A 30 day extension does not bring the prompt straight back.
    expect(expiringSoon([row({ holdUntil: inDays(44) })], 180, 30, now)).toEqual([]);
  });
  it("brings a held client back shortly before the hold ends, using the hold end as the expiry date", () => {
    // Granted 190 days ago: the normal date passed 10 days ago and the coach held it for 20 more days from then.
    const out = expiringSoon([row({ lastGrantedAt: daysAgo(190), holdUntil: inDays(10) })], 180, 30, now);
    expect(out).toHaveLength(1);
    expect(out[0].daysLeft).toBe(10);
    expect(out[0].expiresOn.getTime()).toBe(new Date(inDays(10)).getTime());
  });
  it("ignores a hold that ends before the normal expiry date (the sessions expire on the normal date)", () => {
    const out = expiringSoon([row({ holdUntil: inDays(1) })], 180, 30, now);
    expect(out[0].daysLeft).toBe(14);
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
  it("a final 'leave them expired' answer is tied to that expiry date, so a later expiry asks again", () => {
    const a = expiryFinalKey("a", "g", new Date("2026-01-10T07:00:00Z"));
    expect(a).toBe("expiry-returning-final::a::g::2026-01-10");
    expect(a).not.toBe(expiryFinalKey("a", "g", new Date("2026-09-01T07:00:00Z")));
  });
  it("tells a client the window in plain words, or nothing when sessions do not expire", () => {
    expect(expiryWindowLine(180)).toContain("180 days after your last purchase");
    expect(expiryWindowLine(0)).toBeNull();
  });
});
