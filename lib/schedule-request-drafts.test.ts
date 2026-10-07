import { describe, expect, it } from "vitest";
import { buildCheckInDraft, buildOfferPauseOrFreezeDraft, buildScheduleReplyDraft } from "./schedule-request-drafts";

const MONEY_OR_GUILT = /pay|owe|refund|credit|charge|price|cost|fee|\$|balance|expire|missed|disappoint|sorry to see/i;

describe("schedule request drafts: warm, specific, no money, no guilt", () => {
  it("each reply names the client and the day, and says what happens", () => {
    const pause = buildScheduleReplyDraft({ firstName: "Sam", kind: "pause", effectiveLabel: "Nov 3" });
    expect(pause).toContain("Hi Sam");
    expect(pause).toContain("pause after Nov 3");
    const freeze = buildScheduleReplyDraft({ firstName: "Sam", kind: "freeze", effectiveLabel: "Nov 3", resumeLabel: "Dec 1" });
    expect(freeze).toContain("freeze after Nov 3");
    expect(freeze).toContain("start again on Dec 1");
    const cancel = buildScheduleReplyDraft({ firstName: "Sam", kind: "cancel", effectiveLabel: "Nov 3" });
    expect(cancel).toContain("end after Nov 3");
  });
  it("no draft mentions money, sessions owed, expiry or guilt", () => {
    const all = [
      ...(["pause", "freeze", "cancel"] as const).map((kind) => buildScheduleReplyDraft({ firstName: "Sam", kind, effectiveLabel: "Nov 3", resumeLabel: "Dec 1" })),
      buildOfferPauseOrFreezeDraft("Sam"),
      buildCheckInDraft("Sam"),
    ];
    for (const t of all) expect(t, t).not.toMatch(MONEY_OR_GUILT);
  });
  it("a missing first name becomes 'there', and a freeze with no resume day still reads whole", () => {
    expect(buildScheduleReplyDraft({ firstName: "  ", kind: "pause", effectiveLabel: "Nov 3" })).toContain("Hi there");
    expect(buildOfferPauseOrFreezeDraft("")).toContain("Hi there");
    expect(buildScheduleReplyDraft({ firstName: "Sam", kind: "freeze", effectiveLabel: "Nov 3" })).toContain("start again on the day we agreed");
  });
  it("the drafts take no note: the client's private words are never an input", () => {
    expect(buildScheduleReplyDraft.length).toBe(1);
    expect(buildOfferPauseOrFreezeDraft.length).toBe(1);
  });
  it("the offer is for a cancel and mentions both options", () => {
    const t = buildOfferPauseOrFreezeDraft("Kim");
    expect(t).toContain("pause");
    expect(t).toContain("freeze");
  });
});
