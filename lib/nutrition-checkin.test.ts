import { describe, expect, it } from "vitest";
import { PHASE_CONFIG, runCheckInEngine, clampAdjustmentPct, type CheckInInput } from "./nutrition-checkin";

// All weight pairs below are deliberately chosen (base weight 20 lbs)
// so prevWeight/deltaLbs*100 lands on an exact, floating-point-safe
// percentage — the engine's own comparisons are plain `>=`/`<=` against
// literal thresholds (matching the source tool exactly), so a
// boundary test needs an input that JS floating point actually
// represents as that exact value, not just a decimal that looks right.
function baseInput(overrides: Partial<CheckInInput> = {}): CheckInInput {
  return {
    phase: "fat_loss",
    prevWeightLbs: 20,
    currWeightLbs: 20,
    currentCalories: 2000,
    adherenceDays: 7,
    recoveryRating: 4,
    consecutiveSurplusSpikes: 0,
    ...overrides,
  };
}

describe("runCheckInEngine — adherence gate", () => {
  it("holds calories steady when adherence is below the threshold, regardless of phase", () => {
    const result = runCheckInEngine(
      baseInput({ adherenceDays: PHASE_CONFIG.MIN_ADHERENT_DAYS - 1, currWeightLbs: 19 })
    );
    expect(result.newCalories).toBe(2000);
    expect(result.rationale).toContain("Inconsistent adherence");
  });

  it("evaluates phase logic normally right at the adherence threshold", () => {
    const result = runCheckInEngine(baseInput({ adherenceDays: PHASE_CONFIG.MIN_ADHERENT_DAYS }));
    expect(result.rationale).not.toContain("Inconsistent adherence");
  });
});

describe("runCheckInEngine — fat_loss", () => {
  it("holds steady and reports optimal at the exact optimalPctMax boundary (-0.5%)", () => {
    const result = runCheckInEngine(baseInput({ currWeightLbs: 19.9 })); // -0.1/20 = -0.5%
    expect(result.newCalories).toBe(2000);
    expect(result.rationale).toContain("Optimal fat loss rate achieved");
  });

  it("holds steady and reports optimal at the exact optimalPctMin boundary (-1.2%)", () => {
    const result = runCheckInEngine(baseInput({ currWeightLbs: 19.76 })); // -0.24/20 = -1.2%
    expect(result.newCalories).toBe(2000);
    expect(result.rationale).toContain("Optimal fat loss rate achieved");
  });

  it("applies the aggressive stall cut just past the stall threshold with good recovery", () => {
    // -0.04/20 = -0.2% (> -0.3 stall threshold, outside the optimal band)
    const result = runCheckInEngine(baseInput({ currWeightLbs: 19.96, recoveryRating: 3 }));
    expect(result.newCalories).toBe(Math.round(2000 * PHASE_CONFIG.fat_loss.stallCutAggressivePct));
    expect(result.rationale).toContain("Scaled daily calories down");
  });

  it("applies the conservative stall cut when recovery is low (<= 2)", () => {
    const result = runCheckInEngine(baseInput({ currWeightLbs: 19.96, recoveryRating: 2 }));
    expect(result.newCalories).toBe(Math.round(2000 * PHASE_CONFIG.fat_loss.stallCutConservativePct));
    expect(result.rationale).toContain("conservative");
  });

  it("does not treat a real loss right at the stall boundary as a stall", () => {
    // 250 -> 249.25 is exactly -0.3% (floating-point-safe at this base
    // weight), equal to stallPctThreshold; the check requires STRICTLY
    // greater than -0.3, so this must NOT count as a stall.
    const result = runCheckInEngine(baseInput({ prevWeightLbs: 250, currWeightLbs: 249.25 }));
    expect(result.rationale).not.toContain("stalled");
    expect(result.rationale).not.toContain("plateau");
    expect(result.rationale).toContain("within expected variance");
  });

  it("adds back calories when loss is too rapid, just past the threshold", () => {
    // -0.32/20 = -1.6%, past tooRapidPctThreshold(-1.5)
    const result = runCheckInEngine(baseInput({ currWeightLbs: 19.68 }));
    expect(result.newCalories).toBe(Math.round(2000 * PHASE_CONFIG.fat_loss.tooRapidCalAdjustPct));
    expect(result.rationale).toContain("too rapid");
  });

  it("holds steady exactly at the too-rapid boundary (-1.5%) without triggering the correction", () => {
    // 200 -> 197 is exactly -1.5% (floating-point-safe at this base weight)
    const result = runCheckInEngine(baseInput({ prevWeightLbs: 200, currWeightLbs: 197 }));
    expect(result.newCalories).toBe(2000);
    expect(result.rationale).toContain("within expected variance");
  });
});

describe("runCheckInEngine — hypertrophy", () => {
  it("adds the reversal kcal immediately on any weight drop, resetting spikes", () => {
    const result = runCheckInEngine(
      baseInput({ phase: "hypertrophy", currWeightLbs: 19.9, consecutiveSurplusSpikes: 1 })
    );
    expect(result.newCalories).toBe(2000 + PHASE_CONFIG.hypertrophy.lossReversalKcal);
    expect(result.consecutiveSurplusSpikes).toBe(0);
  });

  it("adds the stall kcal for a small gain under both stall thresholds", () => {
    // +0.01/20 = 0.05%, under stallPctThreshold(0.1); deltaLbs 0.01 <= 0.2
    const result = runCheckInEngine(baseInput({ phase: "hypertrophy", currWeightLbs: 20.01 }));
    expect(result.newCalories).toBe(2000 + PHASE_CONFIG.hypertrophy.stallAddKcal);
  });

  it("does not trim on the first spike week, only increments the counter", () => {
    // +0.14/20 = 0.7%, past spikePctThreshold(0.6)
    const result = runCheckInEngine(
      baseInput({ phase: "hypertrophy", currWeightLbs: 20.14, consecutiveSurplusSpikes: 0 })
    );
    expect(result.newCalories).toBe(2000);
    expect(result.consecutiveSurplusSpikes).toBe(1);
    expect(result.rationale).toContain("settling period");
  });

  it("trims calories only after reaching spikeConsecutiveWeeksToTrim spike weeks", () => {
    const result = runCheckInEngine(
      baseInput({ phase: "hypertrophy", currWeightLbs: 20.14, consecutiveSurplusSpikes: 1 })
    );
    expect(result.newCalories).toBe(2000 - PHASE_CONFIG.hypertrophy.spikeTrimKcal);
    expect(result.consecutiveSurplusSpikes).toBe(0);
  });

  it("holds steady and resets spikes for an on-track gain between stall and spike", () => {
    // +0.06/20 = 0.3% -- between the stall (0.1) and spike (0.6) bands
    const result = runCheckInEngine(
      baseInput({ phase: "hypertrophy", currWeightLbs: 20.06, consecutiveSurplusSpikes: 1 })
    );
    expect(result.newCalories).toBe(2000);
    expect(result.consecutiveSurplusSpikes).toBe(0);
    expect(result.rationale).toContain("on track");
  });
});

describe("runCheckInEngine — reverse_diet", () => {
  it("increases calories by the configured percentage when weight holds flat", () => {
    const result = runCheckInEngine(baseInput({ phase: "reverse_diet", currWeightLbs: 20 }));
    expect(result.newCalories).toBe(Math.round(2000 * (1 + PHASE_CONFIG.reverse_diet.increasePct / 100)));
    expect(result.rationale).toContain("progressing as planned");
  });

  it("increases calories when weight actually dropped, not just held", () => {
    const result = runCheckInEngine(baseInput({ phase: "reverse_diet", currWeightLbs: 19.8 }));
    expect(result.newCalories).toBe(Math.round(2000 * (1 + PHASE_CONFIG.reverse_diet.increasePct / 100)));
  });

  it("still increases right at the flat-or-down boundary (+0.5%)", () => {
    // 200 -> 201 is exactly +0.5% (floating-point-safe at this base weight)
    const result = runCheckInEngine(
      baseInput({ phase: "reverse_diet", prevWeightLbs: 200, currWeightLbs: 201 })
    );
    expect(result.newCalories).toBe(Math.round(2000 * (1 + PHASE_CONFIG.reverse_diet.increasePct / 100)));
  });

  it("holds calories steady when weight is trending up past the flat band", () => {
    // 200 -> 202 is +1% (floating-point-safe) -- past the 0.5% ceiling
    const result = runCheckInEngine(
      baseInput({ phase: "reverse_diet", prevWeightLbs: 200, currWeightLbs: 202 })
    );
    expect(result.newCalories).toBe(2000);
    expect(result.rationale).toContain("Holding calories steady");
  });

  it("still gates on adherence before evaluating the reverse-diet trend", () => {
    const result = runCheckInEngine(
      baseInput({ phase: "reverse_diet", currWeightLbs: 20, adherenceDays: PHASE_CONFIG.MIN_ADHERENT_DAYS - 1 })
    );
    expect(result.newCalories).toBe(2000);
    expect(result.rationale).toContain("Inconsistent adherence");
  });
});

describe("clampAdjustmentPct", () => {
  it("clamps below the floor up to 1", () => {
    expect(clampAdjustmentPct(0)).toBe(1);
    expect(clampAdjustmentPct(-5)).toBe(1);
  });
  it("clamps above the ceiling down to 15", () => {
    expect(clampAdjustmentPct(20)).toBe(15);
  });
  it("leaves an in-range value untouched", () => {
    expect(clampAdjustmentPct(7)).toBe(7);
  });
});

describe("runCheckInEngine — coach-adjustable adjustmentPct", () => {
  it("uses the coach-set percentage for a reverse-diet increase instead of the fixed default", () => {
    const result = runCheckInEngine(baseInput({ phase: "reverse_diet", currWeightLbs: 20, adjustmentPct: 10 }));
    expect(result.newCalories).toBe(Math.round(2000 * 1.1));
    expect(result.rationale).toContain("Increased calories 10%");
  });

  it("clamps an out-of-range adjustmentPct before applying it", () => {
    const result = runCheckInEngine(baseInput({ phase: "reverse_diet", currWeightLbs: 20, adjustmentPct: 999 }));
    expect(result.newCalories).toBe(Math.round(2000 * 1.15));
  });

  it("uses the coach-set percentage for the aggressive fat-loss stall cut, with the conservative cut at exactly half", () => {
    const aggressive = runCheckInEngine(
      baseInput({ currWeightLbs: 19.96, recoveryRating: 3, adjustmentPct: 12 })
    );
    expect(aggressive.newCalories).toBe(Math.round(2000 * (1 - 12 / 100)));

    const conservative = runCheckInEngine(
      baseInput({ currWeightLbs: 19.96, recoveryRating: 2, adjustmentPct: 12 })
    );
    expect(conservative.newCalories).toBe(Math.round(2000 * (1 - 6 / 100)));
  });

  it("leaves the too-rapid-loss safety correction fixed regardless of adjustmentPct", () => {
    const result = runCheckInEngine(baseInput({ currWeightLbs: 19.68, adjustmentPct: 1 }));
    expect(result.newCalories).toBe(Math.round(2000 * PHASE_CONFIG.fat_loss.tooRapidCalAdjustPct));
  });

  it("without adjustmentPct, behavior is unchanged from the original ported defaults", () => {
    const result = runCheckInEngine(baseInput({ phase: "reverse_diet", currWeightLbs: 20 }));
    expect(result.newCalories).toBe(Math.round(2000 * (1 + PHASE_CONFIG.reverse_diet.increasePct / 100)));
  });
});

describe("runCheckInEngine — maintenance", () => {
  it("holds steady with a maintenance-specific rationale", () => {
    const result = runCheckInEngine(baseInput({ phase: "maintenance", currWeightLbs: 20.05 }));
    expect(result.newCalories).toBe(2000);
    expect(result.rationale).toContain("stabilized");
  });
});
