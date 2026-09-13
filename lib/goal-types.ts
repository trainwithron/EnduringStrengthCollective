// Shared display metadata for the goal-type preset+Custom dropdown
// (goal_date_aware_nutrition_and_programming_idea.md) — same proven
// preset+Custom pattern already used for the dashboard word-swap
// presets, not a new UX invention.
import type { GoalType } from "./goal-reversal";

export const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  weight_loss: "Weight loss",
  body_recomp: "Body recomposition",
  muscle_gain: "Muscle gain",
  bodybuilding: "Bodybuilding",
  powerbuilding_strongman: "Powerbuilding / Strongman",
  endurance_event: "Endurance event / Race",
  custom: "Custom…",
};

export const GOAL_TYPE_ORDER: GoalType[] = [
  "weight_loss",
  "body_recomp",
  "muscle_gain",
  "bodybuilding",
  "powerbuilding_strongman",
  "endurance_event",
  "custom",
];

// Only these two goal types show the event-specific fields (sport/
// event type, expected duration, meet priority) — everything else
// leaves them null.
export function goalTypeHasEventFields(goalType: GoalType): boolean {
  return goalType === "powerbuilding_strongman" || goalType === "endurance_event";
}
