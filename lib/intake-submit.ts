import { PAR_Q_QUESTIONS, type ParQAnswer } from "@/lib/par-q-questions";

// The intake form is finished by ONE server call. What the browser sends is checked here: every health question answered yes or no, exactly the questions we ask, a typed name, and the box ticked.
export type IntakeSubmission = { ok: true; answers: ParQAnswer[]; signedName: string } | { ok: false; error: string };

export function validateIntakeSubmission(body: unknown): IntakeSubmission {
  const b = (body ?? {}) as { answers?: unknown; signedName?: unknown; accepted?: unknown };
  if (b.accepted !== true) return { ok: false, error: "Tick the box to accept the waiver." };
  const name = typeof b.signedName === "string" ? b.signedName.trim() : "";
  if (name.length < 2) return { ok: false, error: "Type your full name to sign." };
  if (name.length > 120) return { ok: false, error: "That name is too long." };
  if (!Array.isArray(b.answers) || b.answers.length !== PAR_Q_QUESTIONS.length) return { ok: false, error: "Answer every health question." };
  const answers: ParQAnswer[] = [];
  for (let i = 0; i < PAR_Q_QUESTIONS.length; i++) {
    const a = b.answers[i] as { question?: unknown; answer?: unknown } | null;
    if (!a || typeof a.answer !== "boolean") return { ok: false, error: "Answer every health question." };
    // The question text is ours, never the browser's: the answer is stored against the exact wording that was shown.
    answers.push({ question: PAR_Q_QUESTIONS[i], answer: a.answer });
  }
  return { ok: true, answers, signedName: name };
}
