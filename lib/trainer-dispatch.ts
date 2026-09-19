import type { TrainingIntent } from "./training-intent";
import {
  generateSlotsForDate,
  type AvailabilityWindow,
  type BlockedRange,
  type CandidateSlot,
} from "./booking-slots";
import { nowInZone } from "./timezone";

// org_calendar_spotter_trainer_dispatch_scoping_sept19.md — pure
// matching/ranking/TTL logic for the org-level trainer-dispatch
// cascade, kept separate from the DB-orchestrating submit/advance
// routes so the actual decision logic is unit-testable, matching this
// codebase's established lib/*.ts (pure) vs. lib/*-gather.ts or route
// (I/O) split (e.g. lib/calendar-spotter.ts / lib/calendar-spotter-gather.ts).

export type GoalType =
  | "weight_loss"
  | "body_recomp"
  | "muscle_gain"
  | "bodybuilding"
  | "powerbuilding_strongman"
  | "endurance_event"
  | "custom";

// A trainer's own programs.training_intent is a specialty signal, not a
// literal goal — this mapping is the one place that translates between
// the athlete-facing goal vocabulary (client_goals.goal_type) and the
// coach-facing programming vocabulary (programs.training_intent),
// deliberately not assumed 1:1 per the scoping note's own caution.
const GOAL_TO_TRAINING_INTENTS: Record<GoalType, TrainingIntent[]> = {
  weight_loss: ["Conditioning/Endurance", "General Fitness"],
  body_recomp: ["General Fitness", "Hypertrophy"],
  muscle_gain: ["Hypertrophy"],
  bodybuilding: ["Hypertrophy"],
  powerbuilding_strongman: ["Powerlifting/Strength"],
  endurance_event: ["Conditioning/Endurance"],
  custom: ["General Fitness"],
};

export function mapGoalTypeToTrainingIntents(goalType: GoalType): TrainingIntent[] {
  return GOAL_TO_TRAINING_INTENTS[goalType];
}

export interface TrainerCandidate {
  trainerId: string;
  trainerName: string;
  // How many of this trainer's own programs carry each training_intent —
  // the caller aggregates this from a real query; kept a plain count map
  // here so this stays pure and testable with no DB shape baked in.
  intentCounts: Partial<Record<TrainingIntent, number>>;
}

export interface RankedTrainer {
  trainerId: string;
  trainerName: string;
  fitScore: number;
}

export function computeGoalFitScore(
  intentCounts: Partial<Record<TrainingIntent, number>>,
  goalType: GoalType
): number {
  return mapGoalTypeToTrainingIntents(goalType).reduce(
    (sum, intent) => sum + (intentCounts[intent] ?? 0),
    0
  );
}

// Best-fit-first, per Ron's own explicit confirmation ("we always want
// to present the best possible outcome first"). A trainer with zero
// matching programs still ranks (score 0, last) rather than being
// dropped — every AVAILABLE trainer gets a real shot in the cascade,
// goal-fit only decides the order, not who's eligible at all (that's
// availability's job, checked separately).
export function rankTrainersByFit(candidates: TrainerCandidate[], goalType: GoalType): RankedTrainer[] {
  return candidates
    .map((c) => ({
      trainerId: c.trainerId,
      trainerName: c.trainerName,
      fitScore: computeGoalFitScore(c.intentCounts, goalType),
    }))
    .sort((a, b) => b.fitScore - a.fitScore || a.trainerName.localeCompare(b.trainerName));
}

// Per Ron's own default judgment call (recorded, not yet corrected):
// the TTL keeps running even while a trainer's "ask a question" is
// pending — an unanswered question cascades to the next trainer just
// like a timeout would, rather than blocking everyone else indefinitely.
export function computeStepExpiry(ttlMinutes: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlMinutes * 60000);
}

export function isStepOverdue(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

// The trainer-local calendar day (as a plain Date, midnight-anchored)
// that a UTC instant falls on — shared by findMatchingSlotForTrainer
// below and the gather layer's own resolveBlockedRangesForDate call,
// so both agree on exactly which day's exceptions/windows apply.
export function resolveLocalDateForInstant(instant: Date, timezone: string): Date {
  const dateKey = nowInZone(timezone, instant).toISOString().slice(0, 10);
  return new Date(`${dateKey}T00:00:00`);
}

// Availability matching: does this specific trainer have a real
// generated slot covering the prospect's requested instant? Reuses
// generateSlotsForDate exactly as the single-coach discovery-booking
// flow does — this is the one new piece needed to scan N trainers
// instead of one, not a modification to that shared function.
export function findMatchingSlotForTrainer(
  requestedStartAt: Date,
  windows: AvailabilityWindow[],
  blockedRanges: BlockedRange[],
  timezone: string
): CandidateSlot | null {
  const dateForGeneration = resolveLocalDateForInstant(requestedStartAt, timezone);
  const slots = generateSlotsForDate(dateForGeneration, windows, blockedRanges, timezone);
  return (
    slots.find(
      (s) =>
        requestedStartAt.getTime() >= s.start.getTime() &&
        requestedStartAt.getTime() < s.start.getTime() + s.durationMinutes * 60000
    ) ?? null
  );
}
