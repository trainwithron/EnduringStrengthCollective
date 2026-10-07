import { describe, expect, it } from "vitest";
import { goalToNutritionPhase, phaseFromGoals } from "@/lib/goal-to-nutrition-phase";

describe("goal type to nutrition phase", () => {
  it("maps every goal type", () => {
    expect(goalToNutritionPhase("weight_loss")).toBe("fat_loss");
    expect(goalToNutritionPhase("muscle_gain")).toBe("hypertrophy");
    expect(goalToNutritionPhase("bodybuilding")).toBe("hypertrophy");
    expect(goalToNutritionPhase("powerbuilding_strongman")).toBe("hypertrophy");
    expect(goalToNutritionPhase("body_recomp")).toBe("maintenance");
    expect(goalToNutritionPhase("endurance_event")).toBe("maintenance");
    expect(goalToNutritionPhase("custom")).toBe("maintenance");
    expect(goalToNutritionPhase("nonsense")).toBeNull();
  });
  it("a goal's own phase wins (Rebuild: reverse diet is a custom goal)", () => {
    expect(goalToNutritionPhase("custom", "reverse_diet")).toBe("reverse_diet");
    expect(goalToNutritionPhase("weight_loss", "bogus")).toBe("fat_loss");
  });
});

describe("the phase a client's goals point to", () => {
  it("the newest confirmed goal wins over a newer proposed one", () => {
    const r = phaseFromGoals([
      { goal_type: "muscle_gain", status: "proposed", created_at: "2026-10-05" },
      { goal_type: "weight_loss", status: "confirmed", created_at: "2026-09-01" },
      { goal_type: "body_recomp", status: "confirmed", created_at: "2026-08-01" },
    ]);
    expect(r).toEqual({ phase: "fat_loss", confirmed: true, goalType: "weight_loss" });
  });
  it("a proposed goal still gives a phase, marked not yet confirmed", () => {
    expect(phaseFromGoals([{ goal_type: "muscle_gain", status: "proposed" }])).toEqual({ phase: "hypertrophy", confirmed: false, goalType: "muscle_gain" });
  });
  it("a declined goal and no goals give nothing", () => {
    expect(phaseFromGoals([{ goal_type: "weight_loss", status: "declined" }])).toBeNull();
    expect(phaseFromGoals([])).toBeNull();
  });
});
