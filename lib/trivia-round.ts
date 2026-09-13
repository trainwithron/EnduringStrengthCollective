// Trivia flash-round, a distinct rest-timer activity alongside the
// arcade mini-game library (custom_shape_theming_idea.md) — a different
// pacing shape entirely: answer as many true/false questions correctly
// as possible in the available window, not a survival/difficulty-ramp
// mechanic. The round's only real end condition is the rest countdown
// itself ending (the parent unmounts this component then, same as every
// arcade game) — running out of distinct questions just wraps back to
// the start of a reshuffled queue rather than ending the round early.

export interface TriviaQuestion {
  id: string;
  statement: string;
  correctAnswer: boolean;
}

export interface TriviaRoundState {
  questions: TriviaQuestion[];
  currentIndex: number;
  score: number;
  answered: number;
  status: "playing" | "over"; // "over" only when there are no questions at all
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createTriviaRound(questions: TriviaQuestion[], rng: () => number = Math.random): TriviaRoundState {
  const shuffled = shuffle(questions, rng);
  return {
    questions: shuffled,
    currentIndex: 0,
    score: 0,
    answered: 0,
    status: shuffled.length > 0 ? "playing" : "over",
  };
}

// `answer` is the athlete's swipe: true = "this statement is true",
// false = "this statement is false."
export function answerTrivia(state: TriviaRoundState, answer: boolean): TriviaRoundState {
  if (state.status === "over" || state.questions.length === 0) return state;
  const question = state.questions[state.currentIndex];
  const correct = question.correctAnswer === answer;
  return {
    ...state,
    currentIndex: (state.currentIndex + 1) % state.questions.length,
    score: state.score + (correct ? 1 : 0),
    answered: state.answered + 1,
  };
}
