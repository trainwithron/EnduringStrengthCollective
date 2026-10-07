import { describe, expect, it } from "vitest";
import { AUTO_REFUND_ACTIONS, decideAutoRefund, MEAL_SLOT_DELIVERED_FEATURE } from "@/lib/ai-refund-decision";

describe("the server decides whether an automatic refund is allowed", () => {
  it("allows it only for a meal-plan charge where the AI delivered nothing since the charge", () => {
    expect(decideAutoRefund({ action: "nutrition_plan", hasUnrefundedCharge: true, deliveredSinceCharge: 0 })).toEqual({ allow: true });
  });
  it("refuses it when the AI delivered even one usable suggestion since the charge (a coach who keeps the plan cannot refund it)", () => {
    expect(decideAutoRefund({ action: "nutrition_plan", hasUnrefundedCharge: true, deliveredSinceCharge: 1 })).toEqual({ allow: false, reason: "output_delivered" });
    expect(decideAutoRefund({ action: "nutrition_plan", hasUnrefundedCharge: true, deliveredSinceCharge: 12 })).toEqual({ allow: false, reason: "output_delivered" });
  });
  it("refuses it when there is no charge to refund (no minting)", () => {
    expect(decideAutoRefund({ action: "nutrition_plan", hasUnrefundedCharge: false, deliveredSinceCharge: 0 })).toEqual({ allow: false, reason: "no_charge" });
  });
  it("has no automatic refund for any other action: a program generation has no server-side evidence of delivery", () => {
    expect(decideAutoRefund({ action: "program_generation", hasUnrefundedCharge: true, deliveredSinceCharge: 0 })).toEqual({ allow: false, reason: "action_not_supported" });
    expect(decideAutoRefund({ action: "ci_overview", hasUnrefundedCharge: true, deliveredSinceCharge: 0 })).toEqual({ allow: false, reason: "action_not_supported" });
    expect([...AUTO_REFUND_ACTIONS]).toEqual(["nutrition_plan"]);
  });
  it("the evidence row is the one the meal-slot route writes", () => {
    expect(MEAL_SLOT_DELIVERED_FEATURE).toBe("meal_plan_slot_delivered");
  });
});
