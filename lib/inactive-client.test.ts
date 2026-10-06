import { describe, it, expect } from "vitest";
import {
  KEEP_ACTIVE_SNOOZE_DAYS,
  NOT_NOW_SNOOZE_DAYS,
  buildDoorOpenDraft,
  inactiveDismissalKey,
  inactiveKeepActiveKey,
  inactiveSuggestion,
  isSnoozedFor,
  unansweredFromMessages,
  type InactiveSignals,
} from "./inactive-client";

const base: InactiveSignals = {
  name: "Sam Lee",
  daysSinceActivity: 190,
  daysSinceAdded: 400,
  balance: 1,
  sessionsEverGranted: 3,
  coachMessagesUnanswered: 3,
  daysSinceLastCoachMessage: 40,
};

describe("inactiveSuggestion", () => {
  it("suggests when there has been a long quiet stretch and at least two other signs, with plain reasons", () => {
    const r = inactiveSuggestion(base);
    expect(r?.reasons).toEqual(["last activity about 6 months ago", "1 session left", "only ever had 3 sessions", "3 messages without a reply"]);
  });
  it("needs the long quiet stretch", () => {
    expect(inactiveSuggestion({ ...base, daysSinceActivity: 60 })).toBeNull();
  });
  it("needs at least two of the other signs", () => {
    expect(inactiveSuggestion({ ...base, sessionsEverGranted: 40, coachMessagesUnanswered: 0 })).toBeNull();
    expect(inactiveSuggestion({ ...base, sessionsEverGranted: 40 })?.reasons.length).toBe(3);
  });
  it("does not count unanswered messages when the latest one is recent", () => {
    expect(inactiveSuggestion({ ...base, sessionsEverGranted: 40, daysSinceLastCoachMessage: 3 })).toBeNull();
  });
  it("uses the days since they were added when there has been no activity at all", () => {
    const r = inactiveSuggestion({ ...base, daysSinceActivity: null, daysSinceAdded: 200 });
    expect(r?.reasons[0]).toBe("no workout yet since they were added");
    expect(inactiveSuggestion({ ...base, daysSinceActivity: null, daysSinceAdded: 30 })).toBeNull();
  });
  it("uses neutral wording only", () => {
    const text = JSON.stringify(inactiveSuggestion(base)) + buildDoorOpenDraft("Sam");
    expect(text).not.toMatch(/unresponsive|bad client|not worth|lazy|ghost/i);
  });
});

describe("snoozing and message counting", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const ago = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
  it("keeps the two answers apart and snoozes for the stated time", () => {
    expect(inactiveKeepActiveKey("a", "g")).not.toBe(inactiveDismissalKey("a", "g"));
    expect(isSnoozedFor(ago(10), NOT_NOW_SNOOZE_DAYS, now)).toBe(true);
    expect(isSnoozedFor(ago(20), NOT_NOW_SNOOZE_DAYS, now)).toBe(false);
    expect(isSnoozedFor(ago(60), KEEP_ACTIVE_SNOOZE_DAYS, now)).toBe(true);
    expect(isSnoozedFor(null, 14, now)).toBe(false);
  });
  it("counts the coach's messages sent after the client's last reply", () => {
    const r = unansweredFromMessages(
      [
        { fromClient: false, at: ago(100) },
        { fromClient: true, at: ago(90) },
        { fromClient: false, at: ago(60) },
        { fromClient: false, at: ago(30) },
        { fromClient: false, at: ago(20) },
      ],
      now
    );
    expect(r).toEqual({ unanswered: 3, daysSinceLastCoachMessage: 20 });
  });
  it("counts nothing when the client had the last word, and everything when they never replied", () => {
    expect(unansweredFromMessages([{ fromClient: false, at: ago(50) }, { fromClient: true, at: ago(40) }], now).unanswered).toBe(0);
    expect(unansweredFromMessages([{ fromClient: false, at: ago(50) }, { fromClient: false, at: ago(40) }], now).unanswered).toBe(2);
    expect(unansweredFromMessages([], now)).toEqual({ unanswered: 0, daysSinceLastCoachMessage: null });
  });
});

describe("buildDoorOpenDraft", () => {
  it("is warm, personal and has no guilt or money", () => {
    const t = buildDoorOpenDraft("Sam");
    expect(t).toContain("Hi Sam");
    expect(t).toContain("no pressure");
    expect(t).not.toMatch(/pay|owe|money|refund/i);
    expect(buildDoorOpenDraft("")).toContain("Hi there");
  });
});
