import type { NutritionPhase } from "@/lib/nutrition-checkin";
import { PHASE_LABELS } from "@/lib/phase-plan";
import type { PhaseReview, Stance } from "@/lib/phase-review";
import { formatWeight, type WeightUnit } from "@/lib/units";

// The messages the coach starts from on the phase review card. Fixed wording, no AI: they use ONLY the facts the card shows (so every number in a draft is a number on the card), the
// client's first name, and plain warm language. No pressure, no guilt, no money, no promises, no medical claims, and nothing from the client's private notes. The coach edits them and
// presses Send himself; nothing is ever sent from here.

export interface DraftFacts {
  firstName: string;
  phase: NutritionPhase;
  windowDays: number;
  daysLogged: number;
  // "3.2 lb", already in the client's unit; null when no weight trend could be read.
  changeAmount: string | null;
  changeDirection: "down" | "up" | "flat" | null;
  // Percent of body weight per week, one decimal ("0.8"); null when unknown.
  weeklyRate: string | null;
  underFloor: boolean;
}

export function factsFromReview(review: PhaseReview, firstName: string, unit: WeightUnit): DraftFacts {
  const change = review.changeLbs;
  return {
    firstName: firstName || "there",
    phase: review.phase,
    windowDays: review.elapsedDays,
    daysLogged: review.daysLogged,
    changeAmount: change == null ? null : formatWeight(Math.abs(change), unit),
    changeDirection: change == null ? null : change === 0 ? "flat" : change < 0 ? "down" : "up",
    weeklyRate: review.weeklyRatePct == null ? null : Math.abs(review.weeklyRatePct).toFixed(1),
    underFloor: review.underFloor,
  };
}

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

function weightSentence(f: DraftFacts): string {
  if (f.changeAmount == null || f.changeDirection == null) return "";
  if (f.changeDirection === "flat") return " Your weight has stayed about the same.";
  return ` Your weight is ${f.changeDirection} ${f.changeAmount}${f.weeklyRate ? `, about ${f.weeklyRate} percent of your body weight a week` : ""}.`;
}

const loggedSentence = (f: DraftFacts) => `You logged food on ${f.daysLogged} of the last ${days(f.windowDays)}.`;
const floorSentence = (f: DraftFacts) => (f.underFloor ? " Calories are on the low side of our usual range, so this is a short, watched stretch, and we will not go lower." : "");

export function continueDraft(f: DraftFacts, verdict: PhaseReview["verdict"]): string {
  const why =
    verdict === "on_track"
      ? "That is a steady pace, which is what we want."
      : verdict === "too_fast"
        ? "That is a little faster than I would like, so we will ease off rather than push harder."
        : verdict === "no_change"
          ? "The scale has not moved much yet, so we will give it a little more time and look at the plan together."
          : "I would like to keep going with what we are doing and look again soon.";
  return `Hi ${f.firstName}, I looked at your last ${days(f.windowDays)} of ${PHASE_LABELS[f.phase].toLowerCase()}. ${loggedSentence(f)}${weightSentence(f)} ${why}${floorSentence(f)} Let me know how it feels on your side.`;
}

const NEXT_STEP: Record<NutritionPhase, string> = {
  reverse_diet: "to rebuild with a reverse diet, so your next cut works better",
  maintenance: "to hold your weight steady at maintenance for a while",
  hypertrophy: "to focus on building muscle",
  fat_loss: "to keep the fat-loss phase going",
};

// Used only when the numbers support the move; otherwise the coach gets the plain check-in below.
export function moveDraft(f: DraftFacts, next: NutritionPhase): string {
  return `Hi ${f.firstName}, over the last ${days(f.windowDays)} you logged food on ${f.daysLogged} of them.${weightSentence(f)} That is what I hoped to see: your body responds when we ask it to. The best path now is ${NEXT_STEP[next]}. I am starting your new training block now and will send you the new plan. Tell me if anything about it worries you.`;
}

export function checkInDraft(f: DraftFacts): string {
  return `Hi ${f.firstName}, I am looking at your last ${days(f.windowDays)} to decide the next step. ${loggedSentence(f)}${weightSentence(f)} Before I suggest anything, I would like to hear how it has been going for you. What has been easy, and what has been hard?`;
}

export function lowAdherenceDraft(f: DraftFacts): string {
  return `Hi ${f.firstName}, over the last ${days(f.windowDays)} I can see food logged on ${f.daysLogged} of them, so I cannot read much into the scale yet. No pressure at all: logging more days just helps me give you better advice. Is there anything that makes it hard to log?`;
}

export function extendDraft(f: DraftFacts): string {
  return `Hi ${f.firstName}, I would like a little more time with this phase before we decide the next step. ${loggedSentence(f)}${weightSentence(f)} We will look again soon. There is nothing you need to change.`;
}

// Which message each action starts from.
export function draftsFor(review: PhaseReview, f: DraftFacts, stance: Stance | null, next: NutritionPhase | null): { continue: string; move: string | null; extend: string } {
  const move = next && next !== review.phase ? (stance === "supports" && review.verdict === "on_track" ? moveDraft(f, next) : review.verdict === "low_adherence" ? lowAdherenceDraft(f) : checkInDraft(f)) : null;
  return {
    continue: review.verdict === "low_adherence" ? lowAdherenceDraft(f) : continueDraft(f, review.verdict),
    move,
    extend: extendDraft(f),
  };
}
