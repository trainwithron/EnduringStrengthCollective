// Goal-date-aware nutrition — the goal-reversal flag
// (goal_date_aware_nutrition_and_programming_idea.md). Ron's own
// example: mid-bulk, a client suddenly demands a shred for summer.
// That's not a routine goal update to silently accommodate — it's a
// real signal worth a conversation. Same fact-vs-question governing
// rule as every other spotter in this app: state the verified fact
// plainly (the new goal contradicts the one confirmed on this date),
// never assert WHY (no guessing at frustration, body image, motivation).

export type GoalType =
  | "weight_loss"
  | "body_recomp"
  | "muscle_gain"
  | "bodybuilding"
  | "powerbuilding_strongman"
  | "endurance_event"
  | "custom";

export type GoalDirection = "deficit" | "surplus" | "neutral";

const GOAL_DIRECTION: Record<GoalType, GoalDirection> = {
  weight_loss: "deficit",
  body_recomp: "deficit",
  muscle_gain: "surplus",
  bodybuilding: "surplus",
  powerbuilding_strongman: "surplus",
  endurance_event: "neutral",
  custom: "neutral",
};

// Only a genuine direction flip (deficit <-> surplus) counts as a
// reversal — a change between two goals sharing the same direction
// (muscle_gain -> bodybuilding, both surplus) is a routine update, not
// worth flagging. Neither goal type carrying a clear direction (custom,
// endurance_event) never triggers this — there's nothing to contradict.
export function isGoalReversal(previousGoalType: GoalType, newGoalType: GoalType): boolean {
  const previousDirection = GOAL_DIRECTION[previousGoalType];
  const newDirection = GOAL_DIRECTION[newGoalType];
  if (previousDirection === "neutral" || newDirection === "neutral") return false;
  return previousDirection !== newDirection;
}
