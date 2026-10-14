// Counting a record from imported history as a real one (release CD). The words, and the rule for when a coach can ask (again). Pure.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The same sentence the notification carries: "Your coach wants to count your 900 lb Deadlift from March 2025 as a PR."
export function promotionSentence(weight: number, exerciseName: string, when: string | null): string {
  const lbs = String(weight);
  const date = when ? `${MONTHS[new Date(when).getUTCMonth()]} ${new Date(when).getUTCFullYear()}` : null;
  return `Your coach wants to count your ${lbs} lb ${exerciseName}${date ? ` from ${date}` : ""} as a PR.`;
}

export const REASK_AFTER_DAYS = 30;

export interface PromotionState {
  status: "asked" | "agreed" | "declined";
  answeredAt: string | null;
}

export type CoachControl = { kind: "ask" } | { kind: "waiting" } | { kind: "counts" } | { kind: "declined"; askAgainOn: string } | { kind: "ask_again" };

// What the coach sees on an imported record: Make this PR count, waiting for the answer, it counts, or "not now" with the day they can ask again.
export function coachControlFor(state: PromotionState | undefined, now: Date): CoachControl {
  if (!state) return { kind: "ask" };
  if (state.status === "asked") return { kind: "waiting" };
  if (state.status === "agreed") return { kind: "counts" };
  const answered = state.answeredAt ? new Date(state.answeredAt) : null;
  if (!answered) return { kind: "ask_again" };
  const again = new Date(answered.getTime() + REASK_AFTER_DAYS * 86400000);
  return again.getTime() <= now.getTime() ? { kind: "ask_again" } : { kind: "declined", askAgainOn: again.toISOString().slice(0, 10) };
}
