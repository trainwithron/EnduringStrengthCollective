import type { ParQAnswer } from "@/lib/par-q-questions";

// What a health screening means, in words for the client and for the coach. This is screening, not medical advice and not a clearance: a "yes" to any question means a person who knows the client
// should talk with them before hard training starts. (Our short form is the first page of the PAR-Q+; it has no follow-up pages, so any yes is "talk first".)
export type ScreeningStatus = "clear" | "talk_first";

export function screeningStatus(answers: ParQAnswer[]): ScreeningStatus {
  return answers.some((a) => a.answer === true) ? "talk_first" : "clear";
}

export const SCREENING_LABEL: Record<ScreeningStatus, string> = {
  clear: "Screening on file",
  talk_first: "Talk first",
};

// Said to the client right after they finish.
export const CLIENT_ALL_CLEAR_LINE = "You're all set.";
export const CLIENT_TALK_FIRST_LINE = "Thanks. Because you answered yes to something, your coach will check in with you about it before you start hard training.";

// What the coach decides after a flagged screening.
export type CoachDecision = "cleared" | "modified" | "hold";
export const COACH_DECISIONS: CoachDecision[] = ["cleared", "modified", "hold"];

export const DECISION_BUTTON: Record<CoachDecision, string> = {
  cleared: "Cleared to train",
  modified: "Train with changes",
  hold: "Hold until cleared",
};

export function asDecision(value: unknown): CoachDecision | null {
  return (COACH_DECISIONS as string[]).includes(value as string) ? (value as CoachDecision) : null;
}

// The one line shown in the client's settings once the coach has decided: "Reviewed by you: Train with changes (Oct 12)".
export function decisionLine(decision: CoachDecision | null, acknowledgedAt: string | null): string | null {
  if (!decision) return null;
  const when = acknowledgedAt ? new Date(acknowledgedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return `Reviewed by you: ${DECISION_BUTTON[decision]}${when ? ` (${when})` : ""}`;
}
