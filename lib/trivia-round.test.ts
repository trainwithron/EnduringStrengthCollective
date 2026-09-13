import { describe, expect, it } from "vitest";
import { createTriviaRound, answerTrivia, type TriviaQuestion } from "./trivia-round";

const questions: TriviaQuestion[] = [
  { id: "1", statement: "The deadlift works your hamstrings and glutes.", correctAnswer: true },
  { id: "2", statement: "Spot reduction lets you burn fat from one specific area.", correctAnswer: false },
];

describe("createTriviaRound", () => {
  it("starts playing with every question shuffled in, score at zero", () => {
    const round = createTriviaRound(questions, () => 0);
    expect(round.status).toBe("playing");
    expect(round.score).toBe(0);
    expect(round.answered).toBe(0);
    expect(round.questions.length).toBe(2);
  });

  it("is immediately over with no questions at all", () => {
    const round = createTriviaRound([], () => 0);
    expect(round.status).toBe("over");
  });
});

describe("answerTrivia", () => {
  it("scores a point for a correct true/false answer", () => {
    const round = createTriviaRound(questions, () => 0);
    const current = round.questions[round.currentIndex];
    const next = answerTrivia(round, current.correctAnswer);
    expect(next.score).toBe(1);
    expect(next.answered).toBe(1);
  });

  it("does not score a point for an incorrect answer", () => {
    const round = createTriviaRound(questions, () => 0);
    const current = round.questions[round.currentIndex];
    const next = answerTrivia(round, !current.correctAnswer);
    expect(next.score).toBe(0);
    expect(next.answered).toBe(1);
  });

  it("advances to the next question in the shuffled queue", () => {
    const round = createTriviaRound(questions, () => 0);
    const next = answerTrivia(round, true);
    expect(next.currentIndex).toBe(1);
  });

  it("wraps back to the start once the queue is exhausted, staying playing", () => {
    let round = createTriviaRound(questions, () => 0);
    round = answerTrivia(round, true);
    round = answerTrivia(round, true);
    expect(round.currentIndex).toBe(0);
    expect(round.status).toBe("playing");
    expect(round.answered).toBe(2);
  });

  it("a round with no questions never advances", () => {
    const empty = createTriviaRound([], () => 0);
    expect(answerTrivia(empty, true)).toEqual(empty);
  });
});
