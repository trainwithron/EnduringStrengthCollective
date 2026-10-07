// "The AI generation delivered nothing" is something only the server can know. The browser used to say so (trigger 'auto_validator_failure') and the database
// believed it, so a coach could keep a meal plan and refund its charge. The server now decides, from its own record of what the AI delivered.
//
// The record: whenever the meal-slot route returns at least one option that passed the real-food-data check, it writes one `meal_plan_slot_delivered` row to
// ai_usage_log (server only). An automatic refund is allowed only when the latest unrefunded charge has NO such row since it was made.

export const MEAL_SLOT_DELIVERED_FEATURE = "meal_plan_slot_delivered";

// A coach can generate the slots first and press the charging button afterwards, so delivered rows count from this long BEFORE the charge as well as after it.
export const DELIVERY_LOOKBACK_MS = 30 * 60 * 1000;

export function deliveredSince(chargeCreatedAtIso: string): string {
  return new Date(Date.parse(chargeCreatedAtIso) - DELIVERY_LOOKBACK_MS).toISOString();
}

// The two charged actions a refund can name; anything else is a clean 400 instead of a database error.
export const REFUNDABLE_ACTIONS = ["program_generation", "nutrition_plan"] as const;

// Only the meal-plan charge has an automatic refund (it is the only one the app ever triggered automatically); a program generation has no server-side evidence
// of delivery, so its automatic refund is not available (the coach's own "This was wrong" button still is).
export const AUTO_REFUND_ACTIONS = ["nutrition_plan"] as const;

export type AutoRefundDecision =
  | { allow: true }
  | { allow: false; reason: "action_not_supported" | "no_charge" | "output_delivered" };

export function decideAutoRefund(input: {
  action: string;
  hasUnrefundedCharge: boolean;
  deliveredSinceCharge: number;
}): AutoRefundDecision {
  if (!(AUTO_REFUND_ACTIONS as readonly string[]).includes(input.action)) return { allow: false, reason: "action_not_supported" };
  if (!input.hasUnrefundedCharge) return { allow: false, reason: "no_charge" };
  if (input.deliveredSinceCharge > 0) return { allow: false, reason: "output_delivered" };
  return { allow: true };
}
