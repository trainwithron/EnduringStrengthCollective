import { describe, it, expect } from "vitest";
import { findHelpAnswer, type ThreadMessage } from "./help-answer";
import { buildHelpQuestionDraft } from "./progress-look";

const m = (senderId: string, body: string, t: number): ThreadMessage => ({ senderId, body, createdAt: new Date(Date.UTC(2026, 9, 1, 0, t)).toISOString() });

describe("the client's answer to 'what do you need most help with?'", () => {
  it("is the client's first message after the question the coach really sent", () => {
    const r = findHelpAnswer([m("coach", "See you Tuesday", 1), m("coach", buildHelpQuestionDraft("Sam"), 2), m("sam", "Honestly my deadlift lockout", 3), m("sam", "and sleep", 4)], "coach", "sam");
    expect(r).toMatchObject({ answer: "Honestly my deadlift lockout" });
  });
  it("says it was asked and not answered yet when there is no reply", () => {
    const r = findHelpAnswer([m("coach", buildHelpQuestionDraft("Sam"), 2), m("coach", "Thinking of you", 3)], "coach", "sam");
    expect(r?.answer).toBeNull();
    expect(r?.askedAt).toBeTruthy();
  });
  it("ignores a message from before the question, and a question nobody sent", () => {
    expect(findHelpAnswer([m("sam", "hello", 1), m("coach", "hi", 2)], "coach", "sam")).toBeNull();
    const r = findHelpAnswer([m("sam", "earlier chat", 1), m("coach", buildHelpQuestionDraft("Sam"), 2)], "coach", "sam");
    expect(r?.answer).toBeNull();
  });
  it("uses the latest time the question was asked", () => {
    const r = findHelpAnswer([m("coach", buildHelpQuestionDraft("Sam"), 1), m("sam", "old answer", 2), m("coach", buildHelpQuestionDraft("Sam"), 10), m("sam", "new answer", 11)], "coach", "sam");
    expect(r?.answer).toBe("new answer");
  });
  it("only counts the client's own messages as the answer", () => {
    const r = findHelpAnswer([m("coach", buildHelpQuestionDraft("Sam"), 1), m("other", "not them", 2)], "coach", "sam");
    expect(r?.answer).toBeNull();
  });
});
