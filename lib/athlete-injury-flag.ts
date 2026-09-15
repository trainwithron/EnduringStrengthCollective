// AI Program Builder injury-awareness
// (injury_pain_science_research_and_ai_gap_sept15.md) — the real,
// checkable PAR-Q+ signal this app already collects but never connected
// to program generation. Matches by question TEXT, not array index —
// `client_intake.par_q_answers` stores the question text verbatim at
// the moment of intake (lib/par-q-questions.ts), so matching by
// substring stays correct even if that question list is ever reworded,
// where matching by a hardcoded index would silently break.
const MUSCULOSKELETAL_QUESTION_SUBSTRING = "bone, joint, or soft tissue";

export interface ParQAnswer {
  question: string;
  answer: boolean;
}

// Deliberately narrow: PAR-Q+ has 7 questions, only one (the
// musculoskeletal one) is actually about something exercise SELECTION
// can act on. A "yes" to the heart-condition or medically-supervised
// questions is a real referral trigger (already surfaced by
// ParQAnswersPanel) but isn't itself a reason to change which exercises
// get picked, so it's deliberately not folded into this flag.
export function hasFlaggedMusculoskeletalConcern(answers: ParQAnswer[]): boolean {
  return answers.some(
    (a) => a.answer === true && a.question.toLowerCase().includes(MUSCULOSKELETAL_QUESTION_SUBSTRING)
  );
}
