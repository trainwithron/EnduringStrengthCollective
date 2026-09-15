import { describe, expect, it } from "vitest";
import { hasFlaggedMusculoskeletalConcern } from "./athlete-injury-flag";
import { PAR_Q_QUESTIONS } from "./par-q-questions";

describe("hasFlaggedMusculoskeletalConcern", () => {
  it("returns false for an empty answer set", () => {
    expect(hasFlaggedMusculoskeletalConcern([])).toBe(false);
  });

  it("returns false when every answer is no", () => {
    const answers = PAR_Q_QUESTIONS.map((question) => ({ question, answer: false }));
    expect(hasFlaggedMusculoskeletalConcern(answers)).toBe(false);
  });

  it("returns false when a different question is answered yes", () => {
    const answers = PAR_Q_QUESTIONS.map((question, i) => ({ question, answer: i === 0 }));
    expect(hasFlaggedMusculoskeletalConcern(answers)).toBe(false);
  });

  it("returns true only when the bone/joint/soft-tissue question is yes", () => {
    const musculoskeletalIndex = PAR_Q_QUESTIONS.findIndex((q) =>
      q.toLowerCase().includes("bone, joint, or soft tissue")
    );
    expect(musculoskeletalIndex).toBeGreaterThanOrEqual(0);
    const answers = PAR_Q_QUESTIONS.map((question, i) => ({ question, answer: i === musculoskeletalIndex }));
    expect(hasFlaggedMusculoskeletalConcern(answers)).toBe(true);
  });

  it("still matches if the question text has different surrounding wording", () => {
    const answers = [{ question: "Do you have a bone, joint, or soft tissue problem?", answer: true }];
    expect(hasFlaggedMusculoskeletalConcern(answers)).toBe(true);
  });
});
