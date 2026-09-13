import { describe, expect, it } from "vitest";
import { isGoalReversal } from "./goal-reversal";

describe("isGoalReversal", () => {
  it("flags a real deficit-to-surplus reversal (Ron's own example, reversed)", () => {
    expect(isGoalReversal("muscle_gain", "weight_loss")).toBe(true);
  });

  it("flags a surplus-to-deficit reversal", () => {
    expect(isGoalReversal("bodybuilding", "body_recomp")).toBe(true);
  });

  it("does not flag a same-direction change (both surplus)", () => {
    expect(isGoalReversal("muscle_gain", "bodybuilding")).toBe(false);
  });

  it("does not flag a same-direction change (both deficit)", () => {
    expect(isGoalReversal("weight_loss", "body_recomp")).toBe(false);
  });

  it("never flags when either goal type has no clear direction", () => {
    expect(isGoalReversal("muscle_gain", "endurance_event")).toBe(false);
    expect(isGoalReversal("custom", "weight_loss")).toBe(false);
    expect(isGoalReversal("endurance_event", "custom")).toBe(false);
  });

  it("does not flag an identical goal type", () => {
    expect(isGoalReversal("weight_loss", "weight_loss")).toBe(false);
  });
});
