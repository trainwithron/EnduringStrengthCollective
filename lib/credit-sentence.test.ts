import { describe, it, expect } from "vitest";
import { buildCreditPicture } from "./credit-picture";
import { clientCreditSentence, coachCreditSentence } from "./credit-sentence";

const p = (o: Parameters<typeof buildCreditPicture>[0]) => buildCreditPicture(o);

describe("the click-through sentence for the coach", () => {
  it("reads as a sentence with the history", () => {
    expect(coachCreditSentence(p({ balance: 8, booked: 4, toMark: 0, bought: 12, done: 4 }), "Alice")).toBe("12 sessions bought, 4 completed, 4 booked, and 4 left to schedule.");
    expect(coachCreditSentence(p({ balance: 4, booked: 0, toMark: 0, bought: 10, done: 6 }), "Alice")).toBe("10 sessions bought, 6 completed, and 4 left to schedule.");
    expect(coachCreditSentence(p({ balance: 4, booked: 2, toMark: 0, bought: 10, done: 6 }), "Alice")).toBe("10 sessions bought, 6 completed, 2 booked, and 2 left to schedule.");
  });
  it("drops zero parts and says all completed", () => {
    expect(coachCreditSentence(p({ balance: 0, booked: 0, toMark: 0, bought: 12, done: 12 }), "Alice")).toBe("12 sessions bought, all 12 completed.");
    expect(coachCreditSentence(p({ balance: 0, booked: 0, toMark: 0, bought: 1, done: 1 }), "Alice")).toBe("1 session bought, and it has been completed.");
    expect(coachCreditSentence(p({ balance: 12, booked: 0, toMark: 0, bought: 12, done: 0 }), "Alice")).toBe("12 sessions bought, and 12 left to schedule.");
  });
  it("says when more are booked than are left, by name, without jargon", () => {
    expect(coachCreditSentence(p({ balance: 0, booked: 8, toMark: 0, bought: 12, done: 4 }), "Alice")).toBe("12 sessions bought, 4 completed, and 8 booked; 8 more are booked than Alice has left.");
    expect(coachCreditSentence(p({ balance: 6, booked: 8, toMark: 0, bought: 12, done: 4 }), "Alice")).toBe("12 sessions bought, 4 completed, and 8 booked; 2 more are booked than Alice has left.");
    expect(coachCreditSentence(p({ balance: 1, booked: 2, toMark: 0 }), "Alice")).toBe("Alice has 1 session left: 2 booked. 1 more is booked than Alice has left.");
    expect(coachCreditSentence(p({ balance: 8, booked: 10, toMark: 0 }), "Alice")).not.toMatch(/owed/i);
  });
  it("adds the sessions waiting to be marked", () => {
    expect(coachCreditSentence(p({ balance: 8, booked: 4, toMark: 2, bought: 12, done: 4 }), "Alice")).toBe("12 sessions bought, 4 completed, 4 booked, and 4 left to schedule. 2 are waiting to be marked.");
    expect(coachCreditSentence(p({ balance: 3, booked: 0, toMark: 1 }), "Alice")).toBe("Alice has 3 sessions left. 1 is waiting to be marked.");
  });
  it("works without the history", () => {
    expect(coachCreditSentence(p({ balance: 8, booked: 4, toMark: 0 }), "Alice")).toBe("Alice has 8 sessions left: 4 booked, and 4 left to schedule.");
    expect(coachCreditSentence(p({ balance: 1, booked: 0, toMark: 0 }), "Alice")).toBe("Alice has 1 session left.");
    expect(coachCreditSentence(p({ balance: 0, booked: 0, toMark: 0 }), "Alice")).toBe("Alice has no sessions left.");
  });
  it("says what is already owed", () => {
    expect(coachCreditSentence(p({ balance: -2, booked: 0, toMark: 0 }), "Alice")).toBe("Alice has 0 sessions left. Alice owes 2 sessions.");
  });
  it("uses the coach's own word for a session", () => {
    const noun = { singular: "workout", plural: "workouts" };
    expect(coachCreditSentence(p({ balance: 8, booked: 4, toMark: 0, bought: 12, done: 4 }), "Alice", noun)).toBe("12 workouts bought, 4 completed, 4 booked, and 4 left to schedule.");
    expect(clientCreditSentence(p({ balance: 1, booked: 0, toMark: 0 }), noun)).toBe("You have 1 workout left.");
  });
});

describe("the click-through sentence for a client", () => {
  it("is plain and never says owed or marked", () => {
    expect(clientCreditSentence(p({ balance: 8, booked: 4, toMark: 0 }))).toBe("You have 8 sessions left, and 4 are on the calendar.");
    expect(clientCreditSentence(p({ balance: 8, booked: 1, toMark: 0 }))).toBe("You have 8 sessions left, and 1 is on the calendar.");
    expect(clientCreditSentence(p({ balance: 8, booked: 0, toMark: 0 }))).toBe("You have 8 sessions left.");
    expect(clientCreditSentence(p({ balance: 0, booked: 0, toMark: 0 }))).toBe("You don't have any sessions left right now.");
    const over = clientCreditSentence(p({ balance: 2, booked: 6, toMark: 3 }));
    expect(over).toBe("You have 2 sessions left, and 6 are on the calendar.");
    expect(over).not.toMatch(/owe|mark/i);
  });
});
