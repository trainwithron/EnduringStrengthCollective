// ai_output_foolproofing_and_quality_assurance_idea.md — the reason
// list a coach can optionally pick after a refund has already fired.
// Shared between the "This was wrong" button and any future surface
// that reads refund history.
export const AI_REFUND_REASONS = [
  { value: "ignored_instructions", label: "Wrong / ignored my instructions" },
  { value: "factual_error", label: "Factual error" },
  { value: "too_generic", label: "Too generic" },
  { value: "formatting_broken", label: "Formatting broken" },
  { value: "other", label: "Other" },
] as const;

export type AiRefundReasonValue = (typeof AI_REFUND_REASONS)[number]["value"];

export type AiRefundAction = "program_generation" | "nutrition_plan";
