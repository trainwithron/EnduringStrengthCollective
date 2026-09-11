// A real starting template, not a paraphrase of legal boilerplate — but
// explicitly presented as a starting point, not bulletproof out of the
// box. Enforceability varies by state/jurisdiction; every coach using
// the default text should have it reviewed by their own counsel.
export const DEFAULT_WAIVER_TEXT = `This waiver is a general starting template and has not been reviewed by an attorney for your specific jurisdiction. Your coach should have this document reviewed by a licensed attorney before relying on it.

I understand that participating in physical exercise, strength training, and conditioning activities carries an inherent risk of injury, including but not limited to muscle strains, joint injuries, and in rare cases, more serious harm.

In consideration of being permitted to participate in training sessions and programs offered through this platform, I voluntarily assume all risks associated with participation, and I release my coach and this platform from any and all claims, liabilities, or damages arising from my participation, except in cases of gross negligence or willful misconduct.

I confirm that I have accurately disclosed any relevant health conditions in the questionnaire above, and that I will inform my coach promptly of any changes to my health status that may affect my ability to safely participate.`;

export interface ClientIntakeRow {
  parQAnswers: { question: string; answer: boolean }[];
  waiverAccepted: boolean;
  waiverSignedName: string | null;
  completedAt: string | null;
}

export function isIntakeComplete(row: ClientIntakeRow | null | undefined): boolean {
  return !!row?.completedAt;
}
