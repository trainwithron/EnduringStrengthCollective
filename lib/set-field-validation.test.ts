import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateSetFieldInput } from "./set-field-validation";
import { SET_VALUE_LIMITS, WEIGHT_LIMIT_KG, loggableReps, loggableWeight } from "./set-value-limits";

describe("validateSetFieldInput", () => {
  it("treats an empty cell as cleared", () => {
    expect(validateSetFieldInput("rpe", "  ")).toEqual({ ok: true, value: null });
  });
  it("accepts RPE from 1 to 10 including halves", () => {
    expect(validateSetFieldInput("rpe", "8.5")).toEqual({ ok: true, value: 8.5 });
    expect(validateSetFieldInput("rpe", "10")).toEqual({ ok: true, value: 10 });
    expect(validateSetFieldInput("rpe", "1")).toEqual({ ok: true, value: 1 });
  });
  it("rejects RPE outside 1-10", () => {
    expect(validateSetFieldInput("rpe", "89").ok).toBe(false);
    expect(validateSetFieldInput("rpe", "0").ok).toBe(false);
  });
  it("allows RIR 0 but not above 10", () => {
    expect(validateSetFieldInput("rir", "0")).toEqual({ ok: true, value: 0 });
    expect(validateSetFieldInput("rir", "11").ok).toBe(false);
  });
  it("rejects decimal reps and says why", () => {
    const r = validateSetFieldInput("reps", "5.5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/whole number/);
  });
  it("rejects non-numeric reps instead of saving NaN", () => {
    expect(validateSetFieldInput("reps", "5-8").ok).toBe(false);
    expect(validateSetFieldInput("weight", "abc").ok).toBe(false);
  });
  it("rejects negative weight", () => {
    expect(validateSetFieldInput("weight", "-5").ok).toBe(false);
  });
  it("passes text fields through trimmed", () => {
    expect(validateSetFieldInput("tempo", " 3-1-1 ")).toEqual({ ok: true, value: "3-1-1" });
  });
  it("a weight past the database's 2,000 lb limit is refused on the screen, in pounds and in kilograms", () => {
    expect(validateSetFieldInput("weight", "2000").ok).toBe(true);
    expect(validateSetFieldInput("weight", "2001").ok).toBe(false);
    expect(validateSetFieldInput("weight", "2500").ok).toBe(false);
    expect(WEIGHT_LIMIT_KG).toBe(907);
    expect(validateSetFieldInput("weight", "907", "kg").ok).toBe(true);
    expect(validateSetFieldInput("weight", "908", "kg").ok).toBe(false);
  });
  it("every screen limit is inside the database's limits (the migration text is the source)", () => {
    const sql = readFileSync(join(__dirname, "..", "supabase", "migrations", "0389_scale_and_data_quality.sql"), "utf8");
    expect(sql).toContain(`weight between 0 and ${SET_VALUE_LIMITS.weightLb}`);
    expect(sql).toContain(`reps between 0 and ${SET_VALUE_LIMITS.reps}`);
    expect(sql).toContain(`rpe between 0 and ${SET_VALUE_LIMITS.rpe}`);
    expect(sql).toContain(`time_seconds between 0 and ${SET_VALUE_LIMITS.timeSeconds}`);
    expect(sql).toContain(`distance between 0 and ${SET_VALUE_LIMITS.distance}`);
    // the largest value each screen rule lets through must be accepted by the database
    expect(validateSetFieldInput("reps", String(SET_VALUE_LIMITS.reps)).ok).toBe(true);
    expect(validateSetFieldInput("reps", String(SET_VALUE_LIMITS.reps + 1)).ok).toBe(false);
    expect(validateSetFieldInput("rpe", String(SET_VALUE_LIMITS.rpe + 1)).ok).toBe(false);
    expect(validateSetFieldInput("time", "86400").ok).toBe(true);
    expect(86400).toBeLessThanOrEqual(SET_VALUE_LIMITS.timeSeconds);
    expect(validateSetFieldInput("distance", "100000").ok).toBe(true);
    expect(100000).toBeLessThanOrEqual(SET_VALUE_LIMITS.distance);
  });
  it("a coach's typo target is left blank in the client's set instead of making the workout fail to start", () => {
    expect(loggableWeight(5280)).toBeNull();
    expect(loggableWeight(225)).toBe(225);
    expect(loggableWeight(null)).toBeNull();
    expect(loggableReps(5000)).toBeNull();
    expect(loggableReps(8)).toBe(8);
    expect(readFileSync(join(__dirname, "..", "components", "logging", "start-workout-button.tsx"), "utf8")).toContain("weight: loggableWeight(target.targetWeight)");
  });
});
