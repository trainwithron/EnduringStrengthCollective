// AI Assistant Slice 5 — the athlete free-text reflection field
// (life_impact_reflection_prompt_idea.md). Deliberately NOT a per-
// check-in question — that reads as naggy and cheapens the moment when
// it does land. A deterministic "roughly monthly" cadence (a plain,
// testable stand-in for Ron's own "occasionally... once a month
// sometimes" framing, which was explicitly left unresolved as an exact
// number) rather than true randomness, so the same inputs always
// produce the same answer.
import { seededPick } from "./seeded-pick";

export const MIN_DAYS_BETWEEN_PROMPTS = 30;

// Each names a specific, plausible, behavior-change-adjacent life
// change — Ron's own examples, kept close to verbatim (see the memory
// file) since the specificity is the point: easy to say "actually, yeah"
// to, unlike a generic "how are you feeling outside the gym?"
export const LIFE_IMPACT_PROMPTS: string[] = [
  "Have you noticed any improvements outside of the gym lately?",
  "Have you noticed your energy levels are better?",
  "Have you noticed you've stopped drinking that afternoon coffee?",
  "Have you noticed you're starting to build the habit of parking further away in the parking lot?",
  "Have you noticed you have to think less about the meals you're going to eat — that food is becoming more intuitive?",
];

export function shouldShowLifeImpactPrompt(
  lastAnsweredAt: Date | null,
  now: Date,
  minDays: number = MIN_DAYS_BETWEEN_PROMPTS
): boolean {
  if (!lastAnsweredAt) return true;
  const daysSince = Math.floor((now.getTime() - lastAnsweredAt.getTime()) / (1000 * 60 * 60 * 24));
  return daysSince >= minDays;
}

// Seeded by athlete + the day it's shown, not by post/session — the same
// athlete sees the same prompt if they reload today, but a different one
// next time it's actually due (weeks later, so real rotation happens
// naturally without needing to track "which prompts has this athlete
// already seen").
export function pickLifeImpactPrompt(athleteId: string, todayDateKey: string): string {
  return seededPick(LIFE_IMPACT_PROMPTS, `${athleteId}::${todayDateKey}`);
}
